import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { isSourceImportTooLarge, sourceImportTooLargeMessage } from "@/lib/source-import-limits";
import { importSourceAdapterPayload, previewSourceAdapterPayload } from "@/lib/source-adapters";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const contentType = request.headers.get("content-type") ?? "";
  const dryRunFromQuery = isDryRunQuery(request);

  if (contentType.includes("multipart/form-data")) {
    return importMultipartSourcePayload(request, decodeURIComponent(sourceId), dryRunFromQuery);
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    content?: unknown;
    content_encoding?: unknown;
    contentEncoding?: unknown;
    dry_run?: unknown;
    dryRun?: unknown;
    filename?: unknown;
  };
  const content = typeof body.content === "string" ? body.content : "";
  const contentEncoding = body.content_encoding ?? body.contentEncoding;
  const dryRun = dryRunFromQuery || body.dry_run === true || body.dryRun === true;

  if (!content.trim()) {
    return NextResponse.json({ error: "Import content is required." }, { status: 400 });
  }

  if (contentEncoding !== undefined && contentEncoding !== "base64" && contentEncoding !== "text") {
    return NextResponse.json({ error: "Unsupported import content encoding." }, { status: 400 });
  }

  const byteLength = contentEncoding === "base64" ? Buffer.byteLength(content, "base64") : Buffer.byteLength(content, "utf8");

  if (isSourceImportTooLarge(byteLength)) {
    return NextResponse.json({ error: sourceImportTooLargeMessage() }, { status: 413 });
  }

  return importSourcePayload(decodeURIComponent(sourceId), {
    content,
    contentEncoding: contentEncoding === "base64" ? "base64" : "text",
    dryRun,
    filename: typeof body.filename === "string" ? body.filename : undefined
  });
}

async function importMultipartSourcePayload(request: Request, sourceId: string, dryRunFromQuery: boolean): Promise<NextResponse> {
  const formData = await request.formData();
  const dryRun = dryRunFromQuery || formData.get("dry_run") === "true" || formData.get("dryRun") === "true";
  const file = formData.get("file");
  const filenameField = formData.get("filename");
  const filename = typeof filenameField === "string" ? filenameField : undefined;

  if (isUploadedFile(file)) {
    if (isSourceImportTooLarge(file.size)) {
      return NextResponse.json({ error: sourceImportTooLargeMessage() }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const resolvedFilename = file.name || filename;
    const isZip =
      /\.zip$/i.test(resolvedFilename ?? "") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed" ||
      (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50);

    return importSourcePayload(sourceId, {
      content: isZip ? buffer.toString("base64") : buffer.toString("utf8"),
      contentEncoding: isZip ? "base64" : "text",
      dryRun,
      filename: resolvedFilename
    });
  }

  const content = formData.get("content");

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Import file or content is required." }, { status: 400 });
  }

  if (isSourceImportTooLarge(Buffer.byteLength(content, "utf8"))) {
    return NextResponse.json({ error: sourceImportTooLargeMessage() }, { status: 413 });
  }

  return importSourcePayload(sourceId, { content, contentEncoding: "text", dryRun, filename });
}

async function importSourcePayload(
  sourceId: string,
  input: { content: string; contentEncoding: "base64" | "text"; dryRun?: boolean; filename?: string }
): Promise<NextResponse> {
  try {
    if (input.dryRun) {
      return NextResponse.json(previewSourceAdapterPayload(sourceId, input));
    }

    return NextResponse.json(await importSourceAdapterPayload(sourceId, input));
  } catch (error) {
    return errorResponse(error, "Unable to import source records.", 400);
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" && "arrayBuffer" in value && "size" in value);
}

function isDryRunQuery(request: Request): boolean {
  const params = new URL(request.url).searchParams;
  return params.get("dry_run") === "true" || params.get("dryRun") === "true";
}
