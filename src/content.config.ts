import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
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
