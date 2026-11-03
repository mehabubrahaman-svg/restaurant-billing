import { MEDIA_LIMITS } from '@restroos/application';
import { MediaIdSchema } from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';
import { HttpProblem } from '../problem';

const Base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'base64');
const UploadImageRequestSchema = z.object({
  /** The photo, re-encoded by the web app (long side up to 1280 px), base64. */
  image: Base64.max(Math.ceil((MEDIA_LIMITS.maxImageBytes * 4) / 3) + 4),
  /** Its square thumbnail (320 px), base64. */
  thumbnail: Base64.max(Math.ceil((MEDIA_LIMITS.maxThumbBytes * 4) / 3) + 4),
});
const MediaParams = z.object({ id: MediaIdSchema });

/** Dish photos (docs/05 §2 Media). */
export async function mediaRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { mediaService } = cradle;

  app.post(
    '/media/images',
    { config: { permission: 'menu.manage' }, bodyLimit: 3 * 1024 * 1024 },
    async (request, reply) => {
      const body = UploadImageRequestSchema.parse(request.body);
      const result = mediaService.uploadImage(
        {
          image: new Uint8Array(Buffer.from(body.image, 'base64')),
          thumbnail: new Uint8Array(Buffer.from(body.thumbnail, 'base64')),
        },
        commandContext(request),
      );
      return reply.code(201).send(result);
    },
  );

  // Public: the QR menu shows photos to guests who aren't signed in. An id is
  // the photo's SHA-256, so it can't be guessed and its bytes never change.
  for (const size of ['full', 'thumb'] as const) {
    app.get(
      size === 'full' ? '/media/:id' : '/media/:id/thumb',
      { config: { public: true } },
      async (request, reply) => {
        const { id } = MediaParams.parse(request.params);
        const etag = `"${id}${size === 'thumb' ? '-t' : ''}"`;
        reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('etag', etag)
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox");
        if (request.headers['if-none-match'] === etag) return reply.code(304).send();
        const content = mediaService.content(id, size);
        if (!content) throw new HttpProblem('NOT_FOUND', 'no such photo');
        return reply.type(content.mime).send(Buffer.from(content.bytes));
      },
    );
  }
}
