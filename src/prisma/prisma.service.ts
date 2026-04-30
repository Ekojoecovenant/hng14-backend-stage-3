import { Pool } from '@neondatabase/serverless';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const adapter = new PrismaNeon({ connectionString });

    super({ adapter });
    this.pool = new Pool({ connectionString });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma connected successfully to Neon DB');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
