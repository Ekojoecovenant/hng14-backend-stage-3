import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { FilterProfileDto } from './dto/filter-profile.dto';
import { SearchProfileDto } from './dto/search-profile.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/role.guard';
import { CreateProfileDto } from './dto/create-profile.dto';
import { ExportProfileDto } from './dto/export-profile.dto';
import type { Response } from 'express';
import 'multer';
import { ApiVersionGuard } from '../common/guards/api-version.guard';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('api/profiles')
@UseGuards(JwtAuthGuard, ApiVersionGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  findAll(@Query() filter: FilterProfileDto) {
    return this.profileService.findAll(filter);
  }

  @Get('search')
  search(@Query() searchDto: SearchProfileDto) {
    return this.profileService.search(searchDto);
  }

  @Get('export')
  async export(@Query() exportDto: ExportProfileDto, @Res() res: Response) {
    const csv = await this.profileService.export(exportDto);
    const timestamp = new Date().toISOString().split('T')[0];

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="profiles_${timestamp}.csv"`,
    });

    return res.send(csv);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.profileService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  create(@Body() createProfileDto: CreateProfileDto) {
    return this.profileService.create(createProfileDto);
  }

  @Post('ingest')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(csv)$/i)) {
          return cb(
            new BadRequestException('Only CSV files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async ingest(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }
    return this.profileService.ingestCsv(file.buffer);
  }
}
