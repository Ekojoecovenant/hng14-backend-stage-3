import {
  Body,
  Controller,
  Get,
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

@Controller('profiles')
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

  @Post()
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  create(@Body() createProfileDto: CreateProfileDto) {
    return this.profileService.create(createProfileDto);
  }

  @Get('export')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async export(@Query() exportDto: ExportProfileDto, @Res() res: Response) {
    const data = await this.profileService.export(exportDto);

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="profiles_${new Date().toISOString().split('T')[0]}.csv"`,
    });

    return res.send(data);
  }
}
