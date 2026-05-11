import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Helper for deep search if readdirSync recursive is not available in environment
function findFile(dir: string, predicate: (name: string) => boolean): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const result = findFile(fullPath, predicate);
      if (result) return result;
    } else if (predicate(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const id = searchParams.get('id');
  const filename = searchParams.get('filename');

  let filePath: string | null = null;
  const dataDir = path.join(process.cwd(), 'data');

  try {
    if (type === 'kasios' && filename) {
      filePath = findFile(path.join(dataDir, 'Test Birds from Kasios'), name => name === filename);
    } else if (type === 'verified' && id) {
      filePath = findFile(path.join(dataDir, 'ALL BIRDS'), name => name.replace('.mp3', '').endsWith(`-${id}`));
    }
  } catch (e) {
    console.error("Audio API Error:", e);
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return new NextResponse('Audio file not found', { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileStream = fs.createReadStream(filePath);

  return new NextResponse(fileStream as any, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': stat.size.toString(),
      'Accept-Ranges': 'bytes',
    },
  });
}
