'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/contexts/language-context';
import {
  getAssistantSettings,
  upsertAssistantSettings,
  getKnowledgeFiles,
  deleteKnowledgeFile,
  AssistantSettings,
  KnowledgeFile,
} from '@/lib/services/assistant-settings';
import { Loader as Loader2, Save, Upload, FileText, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/lib/contexts/auth-context';

export default function AssistantSettingsPage() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Partial<AssistantSettings>>({
    system_prompt: '',
    allow_operation_creation: true,
    require_confirmation: true,
    enable_recommendations: true,
    use_warehouse_data: true,
    use_inventory_data: true,
    region: '',
    farm_type: '',
    main_crops: '',
  });
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);

  useEffect(() => {
    loadSettings();
    loadKnowledgeFiles();
  }, []);

  const loadSettings = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const data = await getAssistantSettings(profile.company_id);
      if (data) {
        setSettings(data);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      toast({
        title: t('error'),
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadKnowledgeFiles = async () => {
    if (!profile?.company_id) return;

    try {
      const files = await getKnowledgeFiles(profile.company_id);
      setKnowledgeFiles(files);
    } catch (error) {
      console.error('Failed to load knowledge files:', error);
    }
  };

  const handleSave = async () => {
    if (!profile?.company_id) return;

    try {
      setSaving(true);
      await upsertAssistantSettings(profile.company_id, settings);
      toast({
        title: t('success'),
        description: 'Settings saved successfully',
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast({
        title: t('error'),
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await deleteKnowledgeFile(fileId);
      setKnowledgeFiles((prev) => prev.filter((f) => f.id !== fileId));
      toast({
        title: t('success'),
        description: 'File deleted successfully',
      });
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast({
        title: t('error'),
        description: 'Failed to delete file',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Assistant Settings"
        description="Configure AI assistant behavior, knowledge base, and operational preferences"
      />

      <Card>
        <CardHeader>
          <CardTitle>System Prompt</CardTitle>
          <CardDescription>
            Define the assistant's role, communication style, and operational guidelines
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="system_prompt">Custom System Prompt</Label>
            <Textarea
              id="system_prompt"
              value={settings.system_prompt}
              onChange={(e) =>
                setSettings({ ...settings, system_prompt: e.target.value })
              }
              placeholder="Enter custom system prompt to customize assistant behavior..."
              rows={8}
              className="font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              This prompt will be combined with the base system prompt. Use it to add
              company-specific rules, communication preferences, or operational guidelines.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Behavior Settings</CardTitle>
          <CardDescription>
            Control what actions the assistant can perform
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Allow Operation Creation</Label>
              <div className="text-sm text-slate-500">
                Enable assistant to prepare operation drafts
              </div>
            </div>
            <Switch
              checked={settings.allow_operation_creation}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, allow_operation_creation: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Require Confirmation</Label>
              <div className="text-sm text-slate-500">
                User must confirm before creating operations
              </div>
            </div>
            <Switch
              checked={settings.require_confirmation}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, require_confirmation: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Agronomic Recommendations</Label>
              <div className="text-sm text-slate-500">
                Provide agronomic advice and best practices
              </div>
            </div>
            <Switch
              checked={settings.enable_recommendations}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, enable_recommendations: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Use Warehouse Data</Label>
              <div className="text-sm text-slate-500">
                Include warehouse inventory in context
              </div>
            </div>
            <Switch
              checked={settings.use_warehouse_data}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, use_warehouse_data: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Use Inventory Data</Label>
              <div className="text-sm text-slate-500">
                Include inventory transactions in context
              </div>
            </div>
            <Switch
              checked={settings.use_inventory_data}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, use_inventory_data: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agronomic Profile</CardTitle>
          <CardDescription>
            Help the assistant tailor responses to your farming operation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="region">Region</Label>
            <Input
              id="region"
              value={settings.region}
              onChange={(e) => setSettings({ ...settings, region: e.target.value })}
              placeholder="e.g., North Kazakhstan, Almaty Region"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="farm_type">Farm Type</Label>
            <Input
              id="farm_type"
              value={settings.farm_type}
              onChange={(e) => setSettings({ ...settings, farm_type: e.target.value })}
              placeholder="e.g., Mixed crop, Grain production, Vegetable farm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="main_crops">Main Crops</Label>
            <Input
              id="main_crops"
              value={settings.main_crops}
              onChange={(e) => setSettings({ ...settings, main_crops: e.target.value })}
              placeholder="e.g., Wheat, Potatoes, Sunflower"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Knowledge Base</CardTitle>
          <CardDescription>
            Upload documents to enhance assistant knowledge (PDF, DOCX, XLSX, TXT)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
            <Upload className="h-12 w-12 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-500 mb-3">
              File upload functionality will be implemented with backend support
            </p>
            <Button variant="outline" disabled>
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Button>
          </div>

          {knowledgeFiles.length > 0 && (
            <div className="space-y-2">
              <Label>Uploaded Files</Label>
              <div className="space-y-2">
                {knowledgeFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-slate-400" />
                      <div>
                        <div className="font-medium text-sm">{file.filename}</div>
                        <div className="text-xs text-slate-500">
                          {(file.file_size / 1024).toFixed(1)} KB •{' '}
                          {format(new Date(file.uploaded_at), 'dd.MM.yyyy')}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteFile(file.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              {t('save')} Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
