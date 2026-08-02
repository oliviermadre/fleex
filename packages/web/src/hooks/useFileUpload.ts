import { useState, useCallback, useRef } from 'react';

import { uploadFile } from '../services/api';
import { useToastStore } from '../stores/toastStore';

import type { RefObject, ClipboardEvent, DragEvent } from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

interface UseFileUploadOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (newValue: string) => void;
  onFlushDebounce?: () => void;
}

interface UseFileUploadReturn {
  isUploading: boolean;
  isDragOver: boolean;
  pasteHandler: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  dragProps: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  openFilePicker: () => void;
}

export function useFileUpload(options: UseFileUploadOptions): UseFileUploadReturn {
  const { textareaRef, onChange, onFlushDebounce } = options;
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Use a ref to always read the latest value without stale closures
  const valueRef = useRef(options.value);
  valueRef.current = options.value;

  const uploadAndInsert = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        useToastStore.getState().addToast('error', 'File too large (max 10 MB)');
        return;
      }

      if (!ALLOWED_TYPES.has(file.type) && file.type !== '') {
        useToastStore.getState().addToast('error', `File type ${file.type} is not supported`);
        return;
      }

      onFlushDebounce?.();

      const placeholderId = `fleex-upload-${crypto.randomUUID().slice(0, 8)}`;
      const isImage = file.type.startsWith('image/');
      const placeholder = isImage
        ? `![Uploading ${file.name}...](${placeholderId})`
        : `[Uploading ${file.name}...](${placeholderId})`;

      const ta = textareaRef.current;
      const pos = ta?.selectionStart ?? valueRef.current.length;
      const end = ta?.selectionEnd ?? pos;
      const before = valueRef.current.slice(0, pos);
      const after = valueRef.current.slice(end);
      const withPlaceholder = before + placeholder + after;
      onChange(withPlaceholder);
      valueRef.current = withPlaceholder;
      setIsUploading(true);

      try {
        const result = await uploadFile(file);
        const finalMd = isImage
          ? `![${result.originalName}](${result.url})`
          : `[${result.originalName}](${result.url})`;

        const updated = valueRef.current.replace(placeholder, finalMd);
        onChange(updated);
        valueRef.current = updated;
      } catch (err) {
        const updated = valueRef.current.replace(placeholder, '');
        onChange(updated);
        valueRef.current = updated;
        useToastStore
          .getState()
          .addToast('error', `Upload failed: ${err instanceof Error ? err.message : file.name}`);
      } finally {
        setIsUploading(false);
      }
    },
    [textareaRef, onChange, onFlushDebounce],
  );

  const pasteHandler = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const file = files[0]!;
        // Only intercept if it's an actual file, not text
        if (file.size > 0) {
          e.preventDefault();
          uploadAndInsert(file);
        }
      }
    },
    [uploadAndInsert],
  );

  const dragProps = {
    onDragOver: useCallback((e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }, []),
    onDragLeave: useCallback((e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    }, []),
    onDrop: useCallback(
      (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          uploadAndInsert(files[0]!);
        }
      },
      [uploadAndInsert],
    ),
  };

  const openFilePicker = useCallback(() => {
    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.accept = Array.from(ALLOWED_TYPES).join(',');
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) uploadAndInsert(file);
        input.value = '';
      });
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    fileInputRef.current.click();
  }, [uploadAndInsert]);

  return {
    isUploading,
    isDragOver,
    pasteHandler,
    dragProps,
    openFilePicker,
  };
}
