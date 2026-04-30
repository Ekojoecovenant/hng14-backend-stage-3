import { IsOptional, IsString } from 'class-validator';
import { FilterProfileDto } from './filter-profile.dto';

export class ExportProfileDto extends FilterProfileDto {
  @IsOptional()
  @IsString()
  format?: string = 'csv';
}
