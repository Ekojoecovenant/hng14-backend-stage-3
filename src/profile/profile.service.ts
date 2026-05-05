/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FilterProfileDto } from './dto/filter-profile.dto';
import { SearchProfileDto } from './dto/search-profile.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import axios from 'axios';
import { COUNTRIES } from './utils/country.util';
import { ExportProfileDto } from './dto/export-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

const COUNTRY_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name]),
);

const COUNTRY_ALIAS_TO_CODE: Record<string, string> = Object.fromEntries(
  COUNTRIES.flatMap((c) =>
    c.aliases.map((alias) => [alias.toLowerCase(), c.code]),
  ),
);

// Fixed CSV column order
const CSV_COLUMNS = [
  'id',
  'name',
  'gender',
  'gender_probability',
  'age',
  'age_group',
  'country_id',
  'country_name',
  'country_probability',
  'created_at',
] as const;

@Injectable()
export class ProfileService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async findAll(filter: FilterProfileDto) {
    const normalized = this.cache.normalize({ ...filter });
    const cacheKey = this.cache.buildKey('profiles', normalized);

    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached; // on cache hit

    // on cache miss
    const {
      gender,
      age_group,
      country_id,
      min_age,
      max_age,
      min_country_probability,
      min_gender_probability,
      sort_by = 'created_at',
      order = 'desc',
      page = 1,
      limit = 10,
    } = filter;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(50, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (gender) where.gender = gender.toLowerCase();
    if (age_group) where.age_group = age_group.toLowerCase();

    if (country_id) {
      where.country_id = String(country_id).toUpperCase().trim();
    }

    // age range
    if (min_age || max_age) {
      where.age = {};
      if (min_age) where.age.gte = Number(min_age);
      if (max_age) where.age.lte = Number(max_age);
    }

    // probability filter
    if (min_gender_probability) {
      where.gender_probability = { gte: Number(min_gender_probability) };
    }
    if (min_country_probability) {
      where.country_probability = { gte: Number(min_country_probability) };
    }

    //sorting
    const validSort = [
      'age',
      'created_at',
      'gender_probability',
      'country_probabilty',
      'name',
    ];
    const sortField = validSort.includes(String(sort_by))
      ? String(sort_by)
      : 'created_at';
    const sortOrder = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [data, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limitNum,
        select: {
          id: true,
          name: true,
          gender: true,
          age: true,
          age_group: true,
          country_id: true,
          country_name: true,
          gender_probability: true,
          country_probability: true,
          created_at: true,
        },
      }),
      this.prisma.profile.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const result = {
      status: 'success',
      page: pageNum,
      limit: limitNum,
      total,
      total_pages: totalPages,
      links: {
        self: `/api/profiles?page=${pageNum}&limit=${limitNum}`,
        next:
          pageNum < totalPages
            ? `/api/profiles?page=${pageNum + 1}&limit=${limitNum}`
            : null,
        prev:
          pageNum > 1
            ? `/api/profiles?page=${pageNum - 1}&limit=${limitNum}`
            : null,
      },
      data,
    };

    await this.cache.set(cacheKey, result);
    return result;
  }

  async findOne(id: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
    });
    if (!profile)
      throw new NotFoundException(`Profile with id "${id}" not found`);

    return {
      status: 'success',
      data: profile,
    };
  }

  async search(searchDto: SearchProfileDto) {
    const q = searchDto.q.toLowerCase().trim();
    const where: any = {};

    // Gender
    if (
      (q.includes('male') || q.includes('men')) &&
      !(q.includes('female') || q.includes('women'))
    )
      where.gender = 'male';
    if (
      (q.includes('female') || q.includes('women')) &&
      !(q.includes('male') || q.includes('men'))
    )
      where.gender = 'female';

    // Age group
    if (q.includes('teen') || q.includes('teenager'))
      where.age_group = 'teenager';
    if (q.includes('senior')) where.age_group = 'senior';
    if (q.includes('child')) where.age_group = 'child';
    if (q.includes('adult')) where.age_group = 'adult';

    // "young" age range
    if (q.includes('young') && !where.age_group) {
      where.age = { gte: 16, lte: 24 };
    }

    // Age numbers
    const ageMatch = searchDto.q.match(/(\d+)/);
    if (ageMatch) {
      const num = Number(ageMatch[0]);
      if (q.includes('above') || q.includes('over')) {
        where.age = { ...(where.age || {}), gte: num };
      }
      if (q.includes('below') || q.includes('under')) {
        where.age = { ...(where.age || {}), lte: num };
      }
    }

    // Country detection
    let bestMatch = '';
    for (const alias of Object.entries(COUNTRY_ALIAS_TO_CODE)) {
      if (q.includes(alias[0])) {
        bestMatch = alias[0];
      }
    }

    if (bestMatch) {
      where.country_id = COUNTRY_ALIAS_TO_CODE[bestMatch];
    }

    if (Object.keys(where).length === 0) {
      throw new BadRequestException('Unable to interpret query');
    }

    const page = Math.max(1, Number(searchDto?.page) || 1);
    const limit = Math.min(50, Number(searchDto?.limit) || 10);

    const normalized = this.cache.normalize({ ...where, page, limit });
    const cacheKey = this.cache.buildKey('search', normalized);

    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const [data, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.profile.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const result = {
      status: 'success',
      page,
      limit,
      total,
      total_pages: totalPages,
      links: {
        self: `/api/profiles/search?q=${encodeURIComponent(searchDto.q)}&page=${page}&limit=${limit}`,
        next:
          page < totalPages
            ? `/api/profiles/search?q=${encodeURIComponent(searchDto.q)}&page=${page + 1}&limit=${limit}`
            : null,
        prev:
          page > 1
            ? `/api/profiles/search?q=${encodeURIComponent(searchDto.q)}&page=${page - 1}&limit=${limit}`
            : null,
      },
      data,
    };

    await this.cache.set(cacheKey, result);
    return result;
  }

  async create(createDto: CreateProfileDto) {
    try {
      if (
        !createDto.name ||
        typeof createDto.name !== 'string' ||
        createDto.name.trim() === ''
      ) {
        throw new BadRequestException(
          'Name is required and must be a non-empty string',
        );
      }

      const name = createDto.name.toLowerCase().trim();

      const existing = await this.prisma.profile.findUnique({
        where: { name },
      });

      if (existing) {
        return {
          status: 'success',
          message: 'Profile already exists',
          data: existing,
        };
      }

      // fetch from apis
      const profileData = await this.fetchAndProcessName(name);

      const profile = await this.prisma.profile.create({
        data: {
          name: profileData.name,
          gender: profileData.gender,
          gender_probability: profileData.gender_probability,
          age: profileData.age,
          age_group: profileData.age_group,
          country_id: profileData.country_id,
          country_name: profileData.country_name,
          country_probability: profileData.country_probability,
        },
      });

      await this.cache.invalidateAll();

      return {
        status: 'success',
        data: profile,
      };
    } catch (error: any) {
      if (
        error.message.includes('Genderize') ||
        error.message.includes('Agify') ||
        error.message.includes('Nationalize')
      ) {
        throw new BadGatewayException(error.message);
      }

      throw new InternalServerErrorException('Internal server error');
    }
  }

  async export(filter: ExportProfileDto = {}) {
    const result = await this.findAll({
      ...filter,
      limit: 9999,
      page: 1,
    });

    const header = CSV_COLUMNS.join(',');

    if (result.data.length === 0) {
      return header + '\n';
    }

    const rows = result.data.map((p: any) =>
      CSV_COLUMNS.map((col) => {
        const value = p[col];
        if (value === null || value === undefined) return '';
        const str = String(value);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(','),
    );

    // // csv gen
    // const headers = Object.keys(rows[0] || {});
    // let csv = headers.join(',') + '\n';
    // csv += rows
    //   .map((row) =>
    //     headers
    //       .map((header) => {
    //         const value = row[header];
    //         // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    //         return typeof value === 'string' && value.includes(',')
    //           ? `"${value}"`
    //           : value;
    //       })
    //       .join(','),
    //   )
    //   .join('\n');

    return header + '\n' + rows.join('\n');
  }

  // ingest csv for streaming
  async ingestCsv(fileBuffer: Buffer): Promise<{
    status: string;
    total_rows: number;
    inserted: number;
    skipped: number;
    reasons: Record<string, number>;
  }> {
    const { Readable } = await import('stream');
    const csvParser = (await import('csv-parser')).default;

    const CHUNK_SIZE = 1000;
    const VALID_GENDERS = ['male', 'female'];
    const VALID_AGE_GROUPS = ['child', 'teenager', 'adult', 'senior'];

    let totalRows = 0;
    let inserted = 0;
    const reasons: Record<string, number> = {
      duplicate_name: 0,
      invalid_age: 0,
      invalid_gender: 0,
      invalid_age_group: 0,
      missing_fields: 0,
      malformed_row: 0,
    };

    // stream csv and collect valid rows
    const validRows: any[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = Readable.from(fileBuffer);

      stream
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => {
          totalRows++;

          try {
            // validate name
            const name = row['name']?.trim().toLowerCase();
            if (!name) {
              reasons.missing_fields++;
              return;
            }

            // validate age
            let age: number | null = null;
            if (row['age'] !== undefined && row['age'] !== '') {
              age = Number(row['age']);
              if (isNaN(age) || age < 0 || age > 150) {
                reasons.invalid_age++;
                return;
              }
            }

            //validate gender
            let gender: string | null = null;
            if (row['gender']) {
              gender = row['gender'].trim().toLowerCase();
              if (!VALID_GENDERS.includes(gender)) {
                reasons.invalid_gender++;
                return;
              }
            }

            // validate age_group
            let age_group: string | null = null;
            if (row['age_group']) {
              age_group = row['age_group'].trim().toLowerCase();
              if (!VALID_AGE_GROUPS.includes(age_group)) {
                reasons.invalid_age_group++;
                return;
              }
            }

            // valid rows
            validRows.push({
              name,
              gender,
              gender_probability: row['gender_probability']
                ? Number(row['gender_probability'])
                : null,
              age,
              age_group:
                age_group ?? (age !== null ? this.getAgeGroup(age) : null),
              country_id: row['country_id']?.trim().toUpperCase() || null,
              country_name: row['country_name']?.trim() || null,
              country_probability: row['country_probability']
                ? Number(row['country_probability'])
                : null,
            });
          } catch {
            reasons.malformed_row++;
          }
        })
        .on('end', () => {
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        });
    });

    // batch insert valid rows in chunks
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);

      try {
        const result = await this.prisma.profile.createMany({
          data: chunk,
          skipDuplicates: true,
        });

        inserted += result.count;

        const duplicatesInChunk = chunk.length - result.count;
        reasons.duplicate_name += duplicatesInChunk;
      } catch {
        reasons.malformed_row += chunk.length;
      }
    }

    await this.cache.invalidateAll();

    const totalSkipped = Object.values(reasons).reduce((a, b) => a + b, 0);

    const nonZeroReasons = Object.fromEntries(
      Object.entries(reasons).filter(([, v]) => v > 0),
    );

    return {
      status: 'success',
      total_rows: totalRows,
      inserted,
      skipped: totalSkipped,
      reasons: nonZeroReasons,
    };
  }

  //======== HELPERS============
  private async fetchAndProcessName(name: string) {
    const GENDERIZE_URL = 'https://api.genderize.io';
    const AGIFY_URL = 'https://api.agify.io';
    const NATIONALIZE_URL = 'https://api.nationalize.io';

    const lowerName = name.toLowerCase().trim();

    // genderize call
    const genderData = await this.fetchWithError<{
      name: string;
      gender: string | null;
      probability: number;
      count: number;
    }>(`${GENDERIZE_URL}?name=${lowerName}`, 'Genderize');

    if (!genderData.gender || genderData.count === 0) {
      throw new Error('Genderize returned an invalid response');
    }

    // agify caller
    const ageData = await this.fetchWithError<{
      name: string;
      age: number | null;
      count: number;
    }>(`${AGIFY_URL}?name=${lowerName}`, 'Agify');

    if (ageData.age == null) {
      throw new Error('Agify returned an invalid response');
    }

    // nationalize
    const nationalData = await this.fetchWithError<{
      name: string;
      country: Array<{ country_id: string; probability: number }>;
    }>(`${NATIONALIZE_URL}?name=${lowerName}`, 'Nationalize');

    if (!nationalData.country || nationalData.country.length === 0) {
      throw new Error('Nationalize returned an invalid response');
    }

    // top country
    const topCountry = nationalData.country.reduce((prev, current) =>
      prev.probability > current.probability ? prev : current,
    );

    const ageGroup = this.getAgeGroup(ageData.age);

    return {
      name: lowerName,
      gender: genderData.gender,
      gender_probability: Number(genderData.probability.toFixed(4)),
      age: ageData.age,
      age_group: ageGroup,
      country_id: topCountry.country_id,
      country_name: this.getCountryName(topCountry.country_id),
      country_probability: Number(topCountry.probability.toFixed(4)),
    };
  }

  private async fetchWithError<T>(url: string, apiName: string): Promise<T> {
    try {
      const response = await axios.get(url, { timeout: 5000 });
      return response.data;
    } catch {
      throw new Error(`${apiName} API request failed`);
    }
  }

  private getAgeGroup(age: number | null) {
    if (age === null) return 'adult';
    if (age <= 12) return 'child';
    if (age <= 19) return 'teenager';
    if (age <= 59) return 'adult';
    return 'senior';
  }

  private getCountryName(countryId: string): string {
    return COUNTRY_CODE_TO_NAME[countryId] || 'Unknown';
  }
}
