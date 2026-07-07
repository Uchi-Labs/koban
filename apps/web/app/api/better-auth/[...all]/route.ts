import { getBetterAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getBetterAuth().handler(request);
}

export async function POST(request: Request) {
  return getBetterAuth().handler(request);
}

export async function PATCH(request: Request) {
  return getBetterAuth().handler(request);
}

export async function PUT(request: Request) {
  return getBetterAuth().handler(request);
}

export async function DELETE(request: Request) {
  return getBetterAuth().handler(request);
}
