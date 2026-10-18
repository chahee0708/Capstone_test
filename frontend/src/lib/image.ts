/**
 * image.ts — 업로드 전 이미지 준비
 *
 * 휴대폰 사진(수 MB, 4000px 이상)을 그대로 올리면 느리고 서버 제한에 걸리기 쉽다.
 * 긴 변을 maxSide 로 줄이고 JPEG 로 다시 인코딩한다. 회전(EXIF)은 브라우저가 적용한다.
 * 디코딩할 수 없는 형식(HEIC 등)은 원본을 그대로 돌려 서버가 처리하게 한다.
 */

export async function prepareImage(file: File, maxSide = 2000, quality = 0.88): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxSide / longest);
    const isJpeg = file.type === "image/jpeg";

    // 이미 충분히 작고 JPEG 면 재인코딩하지 않는다 (화질 손실 방지)
    if (scale === 1 && isJpeg && file.size <= 1.5 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    // PNG 투명 배경이 검게 나오지 않도록 흰 배경을 깐다
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** 미리보기용 object URL (사용 후 revokeObjectURL 필요) */
export function previewUrl(file: File): string {
  return URL.createObjectURL(file);
}
