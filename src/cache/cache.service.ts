/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

@Injectable()
export class CacheService {
  private readonly redis!: Redis;
  private readonly ttl: number;
  private readonly logger = new Logger(CacheService.name);
  private readonly enabled: boolean;

  private readonly PROFILE_KEYS_SET = 'tracked:profiles';
  private readonly SEARCH_KEYS_SET = 'tracked:search';

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const token = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    this.enabled = !!(url && token);

    if (this.enabled) {
      this.redis = new Redis({ url: url!, token: token! });
      this.logger.log('Redis cache enabled');
    } else {
      this.logger.warn('Redis env vars missing. Cache disabled');
    }

    this.ttl = this.configService.get<number>('CACHE_TTL') ?? 90;
  }

  private serializeValue(value: unknown): string {
    if (value === null || value === undefined) return '';

    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .map((k) => `${k}=${String(obj[k])}`)
        .join(':');
    }

    if (typeof value === 'string') return value.toLowerCase().trim();
    return String(value);
  }

  normalize(filter: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {};

    for (const key of Object.keys(filter)) {
      const value = filter[key];

      // skip empty, null or underfined values
      if (value === null || value === undefined || value === '') continue;

      if (typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        const sortedNested: Record<string, unknown> = {};
        for (const k of Object.keys(nested).sort()) {
          sortedNested[k] = nested[k];
        }
        cleaned[key] = sortedNested;
        continue;
      }
      cleaned[key] =
        typeof value === 'string' ? value.toLowerCase().trim() : value;
    }

    // sort keys alphabetically
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(cleaned).sort()) {
      sorted[key] = cleaned[key];
    }

    return sorted;
  }

  buildKey(prefix: string, normalizedFilter: Record<string, any>): string {
    const parts = Object.entries(normalizedFilter)
      .map(([k, v]) => `${k}=${this.serializeValue(v)}`)
      .join(':');

    return `${prefix}:${parts}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;

    try {
      const raw = await this.redis.get<string>(key);
      if (raw === null || raw === undefined) return null;

      if (typeof raw === 'object') return raw;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.error(`Cache GET failed for key "${key}": ${err}`);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.redis.set(key, JSON.stringify(value), { px: this.ttl * 1000 });

      if (key.startsWith('profiles:')) {
        await this.redis.sadd(this.PROFILE_KEYS_SET, key);
        await this.redis.expire(this.PROFILE_KEYS_SET, 600);
      } else if (key.startsWith('search:')) {
        await this.redis.sadd(this.SEARCH_KEYS_SET, key);
        await this.redis.expire(this.SEARCH_KEYS_SET, 600);
      }
    } catch (err) {
      this.logger.error(`Cache SET failed for key "${key}": ${err}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.error(`Cache DEL failed for key "${key}": ${err}`);
    }
  }

  async invalidateProfiles(): Promise<void> {
    if (!this.enabled) return;

    try {
      const keys = await this.redis.smembers(this.PROFILE_KEYS_SET);

      if (keys && keys.length > 0) {
        await Promise.all(keys.map((k) => this.redis.del(k)));
        this.logger.log(`Invalidated ${keys.length} profile cache entries`);
      }

      await this.redis.del(this.PROFILE_KEYS_SET);
    } catch (err) {
      this.logger.error(`Profile cache invalidation failed: ${err}`);
    }
  }

  async invalidateSearch(): Promise<void> {
    if (!this.enabled) return;

    try {
      const keys = await this.redis.smembers(this.SEARCH_KEYS_SET);

      if (keys && keys.length > 0) {
        await Promise.all(keys.map((k) => this.redis.del(k)));
        this.logger.log(`Invalidated ${keys.length} search cache entries`);
      }

      await this.redis.del(this.SEARCH_KEYS_SET);
    } catch (err) {
      this.logger.error(`Search cache invalidation failed: ${err}`);
    }
  }

  async invalidateAll(): Promise<void> {
    await Promise.all([this.invalidateProfiles(), this.invalidateSearch()]);
  }
}
