'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, UserPlus, Clock, CircleCheck as CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export default function UsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agronomist');
  const [inviting, setInviting] = useState(false);
  const { profile } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      if (!profile?.company_id) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProfiles(data || []);
    } catch (error) {
      console.error('Error loading profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !profile?.company_id) return;

    setInviting(true);
    try {
      console.log('[DEBUG] Invite button clicked - calling URL:', '/api/invite-user');
      const response = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          company_id: profile.company_id,
        }),
      });

      let result: { error?: string; details?: unknown; success?: boolean; message?: string } = {};
      try {
        result = await response.json();
      } catch {
        throw new Error(`Server returned status ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(result.message || result.error || `Request failed with status ${response.status}`);
      }

      toast({
        title: 'Invitation sent',
        description: `An invitation has been sent to ${inviteEmail}`,
      });

      setInviteDialogOpen(false);
      setInviteEmail('');
      setInviteRole('agronomist');

      setTimeout(loadProfiles, 1000);
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : 'Failed to send invitation';
      console.error('Invitation error:', error);
      toast({
        title: 'Invitation failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  const getRoleBadge = (role: string) => {
    const styles = {
      admin: 'bg-red-100 text-red-800',
      agronomist: 'bg-green-100 text-green-800',
      specialist: 'bg-blue-100 text-blue-800',
      warehouse: 'bg-orange-100 text-orange-800',
    };
    return (
      <Badge className={styles[role as keyof typeof styles] || 'bg-slate-100 text-slate-800'}>
        <Shield className="h-3 w-3 mr-1" />
        {role}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    }
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  if (profile?.role !== 'admin') {
    return (
      <div>
        <PageHeader
          title="Users"
          description="Manage team members and access permissions"
        />
        <Alert variant="destructive">
          <AlertDescription>
            Access denied. Only administrators can view this page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage team members and access permissions"
      >
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite User
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((userProfile) => (
                  <TableRow key={userProfile.id}>
                    <TableCell className="font-medium">{userProfile.email}</TableCell>
                    <TableCell>{getRoleBadge(userProfile.role)}</TableCell>
                    <TableCell>{getStatusBadge(userProfile.status || 'pending')}</TableCell>
                    <TableCell>{new Date(userProfile.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
            <DialogDescription>
              Send an invitation to add a new team member to your company.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole} disabled={inviting}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agronomist">Agronomist</SelectItem>
                  <SelectItem value="specialist">Specialist</SelectItem>
                  <SelectItem value="warehouse">Warehouse</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
              {inviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
