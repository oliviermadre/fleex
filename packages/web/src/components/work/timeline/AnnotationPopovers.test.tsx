import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { UiAnnotation } from '../../../stores/annotationStore';
import { AnnotationViewer } from './AnnotationPopovers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SRC = 'http://localhost:3000/api/files/capture.png';

const annotation: UiAnnotation = {
  id: 'a1', ticketId: 't1', at: '2026-11-02T09:00:00.000Z', title: 'Capture', body: `Voir ![capture.png](${SRC})`,
  tone: 'info', sourceCommentId: null, authorType: 'user', authorName: 'nas',
  createdAt: '2026-11-02T09:00:00.000Z', updatedAt: '2026-11-02T09:00:00.000Z',
};

describe('AnnotationViewer — image in the body', () => {
  // An image must zoom inside Fleex only: a window.open on top of the lightbox leaves the
  // app (desktop hands the URL to the OS, which opens Preview / a browser tab).
  it('opens only the Fleex lightbox when the thumbnail is clicked', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <AnnotationViewer
        annotation={annotation}
        anchor={{ left: 0, top: 0, width: 10, height: 10 }}
        onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onTone={vi.fn()} onSeeComment={vi.fn()}
      />,
    );

    const thumbnail = screen.getByTestId('annotation-viewer').querySelector(`img[src="${SRC}"]`);
    expect(thumbnail).not.toBeNull();
    fireEvent.click(thumbnail!);

    expect(document.querySelector('[data-overlay-top]')).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
