import { LogOut } from "lucide-react";
import Modal from "./Modal.jsx";
import { Button } from "./Field.jsx";

// Shown when the back button is pressed on the first page of the trail -- the
// Dashboard -- so the app does not close by accident.
export default function ExitDialog({ open, appName = "the app", note, onCancel, onConfirm }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Do you really want to quit?"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            <LogOut className="h-4 w-4" />
            Quit
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
          <LogOut className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-slate-600">
            Do you really want to quit {appName}? Everything is saved on the shop&apos;s computer, so
            nothing is lost.
          </p>
          {note && <p className="mt-2 text-xs leading-relaxed text-slate-500">{note}</p>}
        </div>
      </div>
    </Modal>
  );
}
