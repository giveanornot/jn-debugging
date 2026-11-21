import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { categories } from '../config/categories.mjs';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				category: z.string().refine((value) => categories.has(value), 'Unknown category').optional(),
				date: z.coerce.date().optional(),
				tags: z.array(z.string()).default([]),
				status: z.enum(['draft', 'investigating', 'fixed', 'wontfix', 'archived']).optional(),
				system: z.string().optional(),
				severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
				aliases: z.array(z.string()).default([]),
				related: z.array(z.string()).default([]),
			}),
		}),
	}),
};
