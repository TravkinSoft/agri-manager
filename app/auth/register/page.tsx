'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Invite Only Access</CardTitle>
          <CardDescription className="text-center">
            Registration is available only via admin invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 text-center">
          Ask your administrator to invite you by email. Then open the email link and set your password.
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/auth/login">Go to Login</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
