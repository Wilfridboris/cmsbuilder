import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileCheck2 } from "lucide-react";

/**
 * Structural coverage for the extracted `ConfirmActionDialog` (retro A3). The repo test
 * env is `node` (no jsdom); the real shadcn `Dialog` portals its content to
 * `document.body` (via Radix `DialogPortal`), which has no target under
 * `renderToStaticMarkup`, so the portalled content would render empty. The dialog
 * primitives are therefore mocked to render their children inline (mirroring how the
 * form test mocks `framer-motion`), letting us assert on the rendered HTML string that
 * the title/body/confirm label render and that `pending` renders a disabled confirm
 * button with a spinner. Interactive open/close stays manual-review only.
 */

vi.mock("@/components/ui/dialog", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Passthrough,
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
  };
});

import { ConfirmActionDialog } from "@/components/invoices/ConfirmActionDialog";

function render(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

describe("ConfirmActionDialog", () => {
  it("renders the title, body, and confirm label when open", () => {
    const html = render(
      <ConfirmActionDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        pending={false}
        title="Issue this invoice?"
        body="This action mints a number and freezes a PDF."
        confirmLabel="Issue"
        pendingLabel="Issuing"
        cancelLabel="Cancel"
        icon={FileCheck2}
      />,
    );
    expect(html).toContain("Issue this invoice?");
    expect(html).toContain("This action mints a number and freezes a PDF.");
    expect(html).toContain("Issue");
    expect(html).toContain("Cancel");
  });

  it("renders a disabled confirm button with a spinner while pending", () => {
    const html = render(
      <ConfirmActionDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        pending
        title="Issue this invoice?"
        body="Body"
        confirmLabel="Issue"
        pendingLabel="Issuing"
        cancelLabel="Cancel"
        icon={FileCheck2}
      />,
    );
    // The pending label shows and the spinner (animate-spin) is present.
    expect(html).toContain("Issuing");
    expect(html).toContain("animate-spin");
    // The confirm button is disabled while pending. Match the boolean HTML attribute
    // `disabled=""` exactly, not the Tailwind `disabled:` class variants in className.
    expect(html).toContain('disabled=""');
  });
});
