/**
 * prepareImageForOcr.ts
 *
 * 역할: 휴대폰 사진을 OCR(CLOVA) 에 보내기 전에 정리한다
 *   1. 방향 바로잡기: 휴대폰 사진은 픽셀이 옆으로 누운 채 "돌려서 보라"는 표시(EXIF orientation)만 붙어 오는 경우가 많다.
 *      OCR 이 이 표시를 무시하면 글자를 옆으로 누운 채 읽어서 표가 흩어진다 → 실제로 돌려서 다시 그린다
 *   2. 크기 줄이기: 긴 변을 최대 MAX_SIDE(2400px)로. 3~10MB 사진이 수백 KB 가 되어 터널·데이터로도 빨리 올라간다
 *   3. JPEG 로 저장 (HEIC 등도 브라우저가 열 수 있으면 JPEG 로 바뀐다)
 *   브라우저가 사진을 열지 못하면(예: 일부 HEIC) 원본 그대로 보낸다
 *
 * 쓰이는 곳: LabelPhotoReview.tsx(홈 카메라), FoodAnalysisPage.tsx(OCR 탭), ProfilePage.tsx(건강검진표)
 */
const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.92;

export async function prepareImageForOcr(file: File): Promise<File> {
  try {
    // imageOrientation: "from-image" → EXIF 방향표시대로 돌린 그림을 받는다
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // 투명 PNG 도 흰 바탕으로
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
