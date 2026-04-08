import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const type = requestUrl.searchParams.get('type');

  if (type === 'invite' || type === 'recovery') {
    const redirectUrl = new URL('/auth/set-password', request.url);
    const passthroughParams = ['code', 'token_hash', 'type', 'next', 'error', 'error_description'];
    passthroughParams.forEach((key) => {
      const value = requestUrl.searchParams.get(key);
      if (value) redirectUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
