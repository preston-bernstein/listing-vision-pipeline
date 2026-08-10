import { z } from 'zod';

export const ThriftlyRawSchema = z.object({
  id: z.string(),
  title: z.string(),
  price_cents: z.number(),
  category: z.string().optional(),
  image_path: z.string(),
  source_url: z.string(),
  posted_at: z.string(),
  description: z.string().optional(),
});

export type ThriftlyRaw = z.infer<typeof ThriftlyRawSchema>;

export const SecondLookRawSchema = z.object({
  listingId: z.string(),
  name: z.string(),
  priceUsd: z.number(),
  tags: z.array(z.string()),
  photoUrl: z.string(),
  permalink: z.string(),
  listedAt: z.string(),
  details: z.string().optional(),
});

export type SecondLookRaw = z.infer<typeof SecondLookRawSchema>;

export const ReloopRawSchema = z.object({
  title: z.string(),
  price: z.string(),
  imageUrl: z.string(),
  sourceUrl: z.string(),
  postedAt: z.string(),
  description: z.string().optional(),
});

export type ReloopRaw = z.infer<typeof ReloopRawSchema>;
