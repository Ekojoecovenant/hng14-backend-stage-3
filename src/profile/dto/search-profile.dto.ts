import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SearchProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'Query parameter q is required' })
  q!: string;

  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  limit?: string;
}
