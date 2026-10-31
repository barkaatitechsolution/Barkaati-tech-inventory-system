import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import Modal from "./Modal.jsx";
import { Field, Input, Button } from "./Field.jsx";
import { api } from "../api.js";
import { setPasswordPromptHandler } from "../lib/actionGuard.js";

export default function PasswordPrompt() {
  const [request, setRequest] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const resolveRef = useRef(null);

  useEffect(
    () =>
      setPasswordPromptHandler(
        (req) =>
          new Promise((resolve) => {
            resolveRef.current = resolve;
            setPassword("");
            setError("");
            setChecking(false);
            setRequest(req);
          })
      ),
    []
  );

  const close = (ok) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    setPassword("");
    setError("");
    setChecking(false);
    resolve?.(ok);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!password) {
      setError("Enter the password");
      return;
    }
    setChecking(true);
    setError("");
    try {
      const res = await api.verifyActionPassword(password);
      if (res?.valid) close(true);
      else setError("Incorrect password");
    } catch (err) {
      setError(err.message || "Could not verify the password");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      open={!!request}
      onClose={() => close(false)}
      title="Password required"
      subtitle={request?.label ? `Enter your password to ${request.label}` : "Enter your password to continue"}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Lock className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-600">
            Editing and deleting records is protected. Enter the app password set in Settings.
          </p>
        </div>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            autoFocus
            autoComplete="current-password"
            placeholder="Enter password"
          />
        </Field>

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={checking || !password}>
            {checking ? "Checking…" : "Unlock"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
