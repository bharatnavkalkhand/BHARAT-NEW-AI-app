import React, { useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import {
  ANDROID_PROJECT_FILES,
  createAndroidProjectZipBlob,
} from '../engine/androidProjectExport';

export const AndroidSourceView: React.FC = () => {
  const [selectedPath, setSelectedPath] = useState(
    'app/src/main/java/com/bharatai/pocketengine/graphics/FilamentAvatarRenderer.kt'
  );
  const [copied, setCopied] = useState(false);

  const activeFile =
    ANDROID_PROJECT_FILES.find((f) => f.path === selectedPath) ??
    ANDROID_PROJECT_FILES[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownloadZip = () => {
    const blob = createAndroidProjectZipBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bharat-ai-pocket-engine-android.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Native Android Kotlin Source
          </h1>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
            <span className="font-mono">com.bharatai.pocketengine</span>
            <span aria-hidden="true">·</span>
            <span>Kotlin + Jetpack Compose + Google Filament (60 FPS) + MediaCodec + Media3</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{ANDROID_PROJECT_FILES.length} files</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          Download Android Project (.zip)
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* File Tree */}
        <div className="lg:col-span-4 bg-[#101520] border border-white/[0.08] rounded-xl p-3 space-y-1">
          {ANDROID_PROJECT_FILES.map((file) => {
            const fileName = file.path.split('/').pop() ?? file.path;
            const isSelected = file.path === activeFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-2.5 ${
                  isSelected
                    ? 'bg-cyan-400/12 text-cyan-200 border border-cyan-400/30'
                    : 'text-slate-300 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <FileCode2 className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <div className="text-xs font-mono font-medium truncate">{fileName}</div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {file.path}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Code Viewer */}
        <div className="lg:col-span-8 bg-[#0D111A] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-white/[0.08] bg-[#101520]">
            <div className="min-w-0">
              <div className="text-xs font-mono text-slate-100 truncate">
                {activeFile.path}
              </div>
              <div className="text-xs text-slate-400 truncate mt-0.5">
                {activeFile.description}
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy File
                </>
              )}
            </button>
          </div>

          <pre className="p-5 text-xs font-mono leading-relaxed text-slate-200 overflow-auto max-h-[600px]">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
