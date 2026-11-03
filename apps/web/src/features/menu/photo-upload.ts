import { api } from '../../api/endpoints';
import { blobToBase64, preparePhoto } from '../../lib/dish-photos';

/** Prepares one photo in the browser and uploads it to the Hub; resolves to its media id. */
export async function uploadDishPhoto(file: Blob): Promise<string> {
  const prepared = await preparePhoto(file);
  const [image, thumbnail] = await Promise.all([
    blobToBase64(prepared.image),
    blobToBase64(prepared.thumbnail),
  ]);
  return (await api.media.uploadImage({ image, thumbnail })).id;
}
