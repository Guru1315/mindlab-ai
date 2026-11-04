"use client";

import { Cpu, HardDrive, Loader2, LogOut, Monitor, Moon, Palette, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { GEMINI_VOICES } from "@/lib/ai/voices";
import { api, errorMessage } from "@/lib/client/api";
import { formatBytes, formatDuration, formatNumber } from "@/lib/format";
import type { AIStatus } from "@/lib/ai";
import type { Profile, UserSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SettingsResponse {
  profile: Profile;
  settings: UserSettings;
  ai: AIStatus;
}

interface UsageResponse {
  windowDays: number;
  byKind: Record<string, { requests: number; inputTokens: number; outputTokens: number; units: number }>;
  storage: { sourceBytes: number; audioBytes: number; totalBytes: number; sources: number; words: number; audioSeconds: number; notebooks: number };
  limits: { chatPerHour: number; generationPerHour: number; audioPerDay: number; ingestPerHour: number; maxUploadMb: number; maxSourcesPerNotebook: number };
}

const PROVIDER_LABEL: Record<AIStatus["mode"], string> = {
  gemini: "Gemini API",
  gateway: "Vercel AI Gateway",
  none: "none (search mode)",
};

/** Soft storage budget shown for context (Supabase free tier storage is 1 GB). */
const STORAGE_BUDGET = 1024 ** 3;

export function SettingsView() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const { setTheme } = useTheme();

  useEffect(() => {
    api<SettingsResponse>("/api/settings")
      .then((d) => {
        setData(d);
        setSettings(d.settings);
        setName(d.profile?.full_name ?? "");
      })
      .catch((e) => toast.error(errorMessage(e)));
    api<UsageResponse>("/api/usage").then(setUsage).catch(() => {});
  }, []);

  async function save(patch: { profile?: Partial<Profile>; settings?: Partial<UserSettings> }, message = "Settings saved") {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PATCH", json: patch });
      if (patch.settings) setSettings((s) => (s ? { ...s, ...patch.settings } : s));
      toast.success(message);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage your profile, preferences and usage.</p>

      {!data || !settings ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <Tabs defaultValue="profile" className="mt-8">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="profile">
              <User /> Profile
            </TabsTrigger>
            <TabsTrigger value="appearance">
              <Palette /> Appearance
            </TabsTrigger>
            <TabsTrigger value="ai">
              <Cpu /> AI
            </TabsTrigger>
            <TabsTrigger value="usage">
              <HardDrive /> Usage
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-6 space-y-6">
            <Section title="Profile" description="How you appear in MindLab.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={data.profile?.email ?? ""} disabled />
                </div>
              </div>
              <Button className="mt-4" disabled={saving} onClick={() => save({ profile: { full_name: name.trim() || null } }, "Profile updated")}>
                {saving && <Loader2 className="animate-spin" />} Save profile
              </Button>
            </Section>
            <Section title="Account" description="Sign out of MindLab on this device.">
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="outline">
                  <LogOut /> Sign out
                </Button>
              </form>
            </Section>
          </TabsContent>

          <TabsContent value="appearance" className="mt-6">
            <Section title="Theme" description="Choose how MindLab looks. Saved to your account.">
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    { id: "light", label: "Light", icon: Sun },
                    { id: "dark", label: "Dark", icon: Moon },
                    { id: "system", label: "System", icon: Monitor },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTheme(t.id);
                      save({ settings: { theme: t.id } }, "Theme updated");
                    }}
                    aria-pressed={settings.theme === t.id}
                    className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition", settings.theme === t.id ? "border-brand bg-brand-soft/50" : "hover:bg-muted/60")}
                  >
                    <t.icon className="size-5" /> {t.label}
                  </button>
                ))}
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="ai" className="mt-6 space-y-6">
            {!data.ai.generation && (
              <p className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
                <strong>Search mode.</strong> No AI provider is configured, so chat quotes the best-matching passages from your sources and
                Studio and audio overviews are unavailable. An administrator can set GEMINI_API_KEY, or enable Vercel AI Gateway with
                AI_PROVIDER=gateway (no API key needed on Vercel).
              </p>
            )}
            <Section title="Chat" description="How answers are written. Grounding rules always apply.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Response style</Label>
                  <Select value={settings.chat_style} onValueChange={(v) => setSettings({ ...settings, chat_style: v as UserSettings["chat_style"] })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default — research assistant</SelectItem>
                      <SelectItem value="learning">Learning guide — tutor style</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Response length</Label>
                  <Select value={settings.response_length} onValueChange={(v) => setSettings({ ...settings, response_length: v as UserSettings["response_length"] })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">Shorter</SelectItem>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="long">Longer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {settings.chat_style === "custom" && (
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="custom">Custom style</Label>
                  <Textarea
                    id="custom"
                    rows={3}
                    maxLength={2000}
                    value={settings.custom_instructions ?? ""}
                    onChange={(e) => setSettings({ ...settings, custom_instructions: e.target.value })}
                    placeholder="e.g. Respond like a PhD advisor: concise, critical, with suggestions for further reading from my sources."
                  />
                </div>
              )}
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="model">Chat model</Label>
                <Input
                  id="model"
                  value={settings.chat_model ?? ""}
                  onChange={(e) => setSettings({ ...settings, chat_model: e.target.value || null })}
                  placeholder={data.ai.models ? `Default: ${data.ai.models.chat}` : "Unavailable in search mode"}
                />
                <p className="text-xs text-muted-foreground">Leave empty to use the server default. Must be a Gemini model id available to the server&apos;s API key.</p>
              </div>
            </Section>
            <Section title="Audio overview voices" description="Default voices for the two hosts.">
              <div className="grid gap-4 sm:grid-cols-2">
                {(["audio_host_voice", "audio_guest_voice"] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <Label>{key === "audio_host_voice" ? "Host (Alex)" : "Co-host (Sam)"}</Label>
                    <Select value={settings[key]} onValueChange={(v) => setSettings({ ...settings, [key]: v })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {GEMINI_VOICES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </Section>
            <Button
              disabled={saving}
              onClick={() =>
                save({
                  settings: {
                    chat_style: settings.chat_style,
                    response_length: settings.response_length,
                    custom_instructions: settings.custom_instructions?.trim() || null,
                    chat_model: settings.chat_model?.trim() || null,
                    audio_host_voice: settings.audio_host_voice,
                    audio_guest_voice: settings.audio_guest_voice,
                  },
                })
              }
            >
              {saving && <Loader2 className="animate-spin" />} Save AI settings
            </Button>
            <Section title="Models in use" description={`Provider: ${PROVIDER_LABEL[data.ai.mode]}`}>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {[
                  ["Chat", data.ai.models?.chat ?? "Keyword search"],
                  ["Fast tasks", data.ai.models?.fast ?? "—"],
                  ["Embeddings", data.ai.models?.embedding ?? "Keyword index"],
                  ["Speech", data.ai.models?.tts ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between rounded-lg bg-muted/60 px-3 py-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-xs">{v}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </TabsContent>

          <TabsContent value="usage" className="mt-6 space-y-6">
            {!usage ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <>
                <Section title="Storage" description="Files and audio stored for your account.">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{formatBytes(usage.storage.totalBytes)} used</span>
                    <span className="text-muted-foreground">of {formatBytes(STORAGE_BUDGET)}</span>
                  </div>
                  <Progress value={Math.min(100, (usage.storage.totalBytes / STORAGE_BUDGET) * 100)} className="mt-2" />
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Stat label="Notebooks" value={formatNumber(usage.storage.notebooks)} />
                    <Stat label="Sources" value={formatNumber(usage.storage.sources)} />
                    <Stat label="Words indexed" value={formatNumber(usage.storage.words)} />
                    <Stat label="Audio" value={formatDuration(usage.storage.audioSeconds)} />
                  </div>
                </Section>
                <Section title={`AI usage (last ${usage.windowDays} days)`} description="Requests and tokens recorded for your account.">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 font-medium">Type</th>
                          <th className="py-2 text-right font-medium">Requests</th>
                          <th className="py-2 text-right font-medium">Input tokens</th>
                          <th className="py-2 text-right font-medium">Output tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(usage.byKind).length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-muted-foreground">
                              No usage yet.
                            </td>
                          </tr>
                        )}
                        {Object.entries(usage.byKind).map(([kind, u]) => (
                          <tr key={kind} className="border-b last:border-0">
                            <td className="py-2 capitalize">{kind}</td>
                            <td className="py-2 text-right tabular-nums">{formatNumber(u.requests)}</td>
                            <td className="py-2 text-right tabular-nums">{formatNumber(u.inputTokens)}</td>
                            <td className="py-2 text-right tabular-nums">{formatNumber(u.outputTokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
                <Section title="Limits" description="Fair-use limits for your account.">
                  <ul className="grid gap-2 text-sm sm:grid-cols-2">
                    <li>Chat: {usage.limits.chatPerHour} questions / hour</li>
                    <li>Studio: {usage.limits.generationPerHour} generations / hour</li>
                    <li>Audio overviews: {usage.limits.audioPerDay} / day</li>
                    <li>Source imports: {usage.limits.ingestPerHour} / hour</li>
                    <li>Max file size: {usage.limits.maxUploadMb} MB</li>
                    <li>Sources per notebook: {usage.limits.maxSourcesPerNotebook}</li>
                  </ul>
                </Section>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}
