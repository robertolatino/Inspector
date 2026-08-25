import { NextResponse } from 'next/server';
import { borrarSesion } from '@/lib/session';

export async function POST() {
  await borrarSesion();
  return NextResponse.json({ ok: true });
}
