export const PROFILE_AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";
export const PROFILE_AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const PROFILE_AVATAR_MAX_EDGE = 512;

const ALLOWED_SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function calculateSquareCrop(width: number, height: number) {
  const sourceEdge = Math.min(width, height);
  const outputEdge = Math.min(PROFILE_AVATAR_MAX_EDGE, sourceEdge);
  return {
    sourceX: Math.max(0, (width - sourceEdge) / 2),
    sourceY: Math.max(0, (height - sourceEdge) / 2),
    sourceEdge,
    outputEdge,
  };
}

function loadBrowserImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    image.src = url;
  });
}

export async function prepareProfileAvatarWebp(file: File): Promise<File> {
  if (!ALLOWED_SOURCE_TYPES.has(file.type)) throw new Error("Выберите JPEG, PNG или WebP");
  if (file.size < 1 || file.size > PROFILE_AVATAR_MAX_SOURCE_BYTES) {
    throw new Error("Размер исходного изображения не должен превышать 5 МБ");
  }
  const image = await loadBrowserImage(file);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("У изображения нет допустимых размеров");
  const crop = calculateSquareCrop(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = crop.outputEdge;
  canvas.height = crop.outputEdge;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Браузер не поддерживает подготовку фото");
  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceEdge,
    crop.sourceEdge,
    0,
    0,
    crop.outputEdge,
    crop.outputEdge,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob || blob.type !== "image/webp") throw new Error("Браузер не смог преобразовать фото в WebP");
  return new File([blob], "avatar.webp", { type: "image/webp", lastModified: Date.now() });
}
