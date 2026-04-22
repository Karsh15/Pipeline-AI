/**
 * NVIDIA NIM OCR client — adapted from OCR-V1 repo.
 * Sends images (base64) to nemo-retriever-ocr-v1 and returns structured text.
 */

const NVCF_BASE = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions";
const OCR_FUNCTION_ID = "95298231-10d9-4ec9-801b-ab0d439c73a2";

export interface NvidiaOcrResult {
  text: string;
  confidence: number;
}

export interface NvidiaOcrOptions {
  apiKey: string;
  mergeLevel?: "word" | "sentence" | "paragraph";
  maxRetries?: number;
}

interface TextDetection {
  text_prediction: { text: string; confidence: number };
  bounding_box: { points: { x: number; y: number }[] };
}

export async function nvidiaOcrRecognize(
  imageBuffer: Buffer | Uint8Array,
  options: NvidiaOcrOptions
): Promise<NvidiaOcrResult> {
  const { apiKey, mergeLevel = "paragraph", maxRetries = 2 } = options;
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const dataUrl = `data:image/png;base64,${base64}`;
  const endpoint = `${NVCF_BASE}/${OCR_FUNCTION_ID}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          input: [{ type: "image_url", url: dataUrl }],
          merge_levels: [mergeLevel],
        }),
      });

      if (res.status === 429) {
        const waitMs = Math.min(2000 * (attempt + 1), 10000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`NVIDIA OCR HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as { data?: { text_detections?: TextDetection[] }[] };
      const detections = data.data?.[0]?.text_detections || [];
      const mapped = detections.map((d) => ({
        text: d.text_prediction.text,
        confidence: d.text_prediction.confidence,
        y: d.bounding_box.points[0]?.y ?? 0,
        x: d.bounding_box.points[0]?.x ?? 0,
      }));

      // Sort top-to-bottom, left-to-right
      mapped.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 0.008) return a.y - b.y;
        return a.x - b.x;
      });

      const fullText = mapped.map((d) => d.text).join("\n");
      const avgConf = mapped.length > 0 ? mapped.reduce((s, d) => s + d.confidence, 0) / mapped.length : 0;

      return { text: fullText, confidence: avgConf * 100 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("NVIDIA OCR failed after retries");
}
