import { AlertTriangle } from "lucide-react";
import Modal from "./Modal.jsx";
import { Button } from "./Field.jsx";

export default function ConfirmDialog({ open, title = "Delete item?", message, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="text-sm text-slate-600">{message || "This action cannot be undone."}</p>
      </div>
    </Modal>
  );
}