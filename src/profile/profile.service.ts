/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FilterProfileDto } from './dto/filter-profile.dto';
import { SearchProfileDto } from './dto/search-profile.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import axios from 'axios';
import { COUNTRIES } from './utils/country.util';
import { ExportProfileDto } from './dto/export-profile.dto';

const COUNTRY_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name]),
);

const COUNTRY_ALIAS_TO_CODE: Record<string, string> = Object.fromEntries(
  COUNTRIES.flatMap((c) =>
    c.aliases.map((alias) => [alias.toLowerCase(), c.code]),
  ),
);

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: FilterProfileDto) {
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
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};

    if (gender) where.gender = gender.toLowerCase();
    if (age_group) where.age_group = age_group.toLowerCase();

    if (country_id) {
      const code = String(country_id).toUpperCase().trim();
      where.country_id = code;
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
    const validSort = ['age', 'created_at', 'gender_probability'];
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

    return {
      status: 'success',
      page: pageNum,
      limit: limitNum,
      total,
      total_pages: Math.ceil(total / limitNum),
      links: {
        self: `/profiles?page=${pageNum}&limit=${limitNum}`,
        next:
          pageNum * limitNum < total
            ? `/profiles?page=${pageNum + 1}&limit=${limitNum}`
            : null,
        prev:
          pageNum > 1
            ? `/profiles?page=${pageNum - 1}&limit=${limitNum}`
            : null,
      },
      data,
    };
  }

  async search(searchDto: SearchProfileDto) {
    const q = searchDto.q.toLowerCase().trim();
    const where: any = {};

    // Gender
    if (q.includes('male') && !q.includes('female')) where.gender = 'male';
    if (q.includes('female') && !q.includes('male')) where.gender = 'female';

    // Age group
    if (q.includes('young')) where.age = { gte: 16, lte: 24 };
    if (q.includes('teen') || q.includes('teenager'))
      where.age_group = 'teenager';
    if (q.includes('adult')) where.age_group = 'adult';
    if (q.includes('senior')) where.age_group = 'senior';
    if (q.includes('child')) where.age_group = 'child';

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
    for (const [name, code] of Object.entries(COUNTRY_ALIAS_TO_CODE)) {
      if (q.includes(name)) {
        where.country_id = code;
        break;
      }
    }

    if (Object.keys(where).length === 0) {
      throw new Error('Unable to interpret query');
    }

    const page = Number(searchDto?.page) || 1;
    const limit = Math.min(50, Number(searchDto?.limit) || 10);

    const [data, total] = await Promise.all([
      this.prisma.profile.findMany({
        where: { ...where },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.profile.count({ where }),
    ]);

    return {
      status: 'success',
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      links: {
        self: `/profiles?page=${page}&limit=${limit}`,
        next:
          page * limit < total
            ? `/profiles?page=${page + 1}&limit=${limit}`
            : null,
        prev: page > 1 ? `/profiles?page=${page - 1}&limit=${limit}` : null,
      },
      data,
    };
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
    const allData = await this.findAll({
      ...filter,
      limit: 9999,
      page: 1,
    });

    const rows = allData.data.map((p) => ({
      id: p.id,
      name: p.name,
      gender: p.gender,
      gender_probability: p.gender_probability,
      age: p.age,
      age_group: p.age_group,
      country_id: p.country_id,
      country_name: p.country_name,
      country_probability: p.country_probability,
      created_at: p.created_at,
    }));

    // csv gen
    const headers = Object.keys(rows[0] || {});
    let csv = headers.join(',') + '\n';

    csv += rows
      .map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return typeof value === 'string' && value.includes(',')
              ? `"${value}"`
              : value;
          })
          .join(','),
      )
      .join('\n');

    return csv;
  }

  //======== HELPERS=============
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
