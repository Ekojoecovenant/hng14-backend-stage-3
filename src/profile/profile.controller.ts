import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { FilterProfileDto } from './dto/filter-profile.dto';
import { SearchProfileDto } from './dto/search-profile.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/role.guard';
import { CreateProfileDto } from './dto/create-profile.dto';
import { ExportProfileDto } from './dto/export-profile.dto';
import type { Response } from 'express';
import { ApiVersionGuard } from 'src/common/guards/api-version.guard';

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
}
