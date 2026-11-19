import { useEffect, useRef, useState } from "react";
import { Delete, Fingerprint, Lock, ShieldCheck } from "lucide-react";
import {
  biometricAvailable,
  hasBiometricEnabled,
  resetApp,
  setupPin,
  unlockWithBiometric,
  verifyPin
} from "../lib/auth.js";
import { Button, Modal, Spinner, cx } from "../components/ui.jsx";

function Dots({ length, filled }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {Array.from({ length }).map((_, i) => (
        <span
          key={i}
          className={cx(
            "h-3.5 w-3.5 rounded-full transition",
            i < filled ? "scale-110 bg-white" : "bg-white/25"
          )}
        />
      ))}
    </div>
  );
}

function Keypad({ onDigit, onDelete, disabled }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-3">
      {keys.map((key, i) => {
        if (!key) return <span key={i} />;
        if (key === "del") {
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={onDelete}
              className="flex h-16 items-center justify-center rounded-2xl text-white/80 active:bg-white/10 disabled:opacity-40"
              aria-label="Delete"
            >
              <Delete className="h-6 w-6" />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onDigit(key)}
            className="h-16 rounded-2xl bg-white/10 text-2xl font-semibold text-white active:bg-white/20 disabled:opacity-40"
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}

export default function AuthScreen({ mode, onUnlocked }) {
  const isSetup = mode === "setup";
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [step, setStep] = useState("enter");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const autoUnlockTried = useRef(false);

  useEffect(() => {
    (async () => {
      setBioAvailable(await biometricAvailable());
      setBioEnabled(await hasBiometricEnabled());
    })();
  }, []);

  useEffect(() => {
    if (isSetup || !bioEnabled || autoUnlockTried.current) return;
    autoUnlockTried.current = true;
    setBusy(true);
    unlockWithBiometric()
      .then(onUnlocked)
      .catch(() => setBusy(false));
  }, [isSetup, bioEnabled, onUnlocked]);

  const submit = async (value) => {
    setError("");
    setBusy(true);
    try {
      if (isSetup) {
        if (step === "enter") {
          setFirstPin(value);
          setPin("");
          setStep("confirm");
        } else {
          if (value !== firstPin) {
            setError("The two PINs did not match. Try again.");
            setFirstPin("");
            setPin("");
            setStep("enter");
          } else {
            await setupPin(value);
            onUnlocked();
          }
        }
      } else {
        const ok = await verifyPin(value);
        if (!ok) {
          setError("That PIN is not correct.");
          setPin("");
        } else {
          onUnlocked();
        }
      }
    } catch (e) {
      setError(e?.message || "Something went wrong.");
      setPin("");
      if (isSetup) {
        setFirstPin("");
        setStep("enter");
      }
    } finally {
      setBusy(false);
    }
  };

  const press = (digit) => {
    if (busy) return;
    const next = `${pin}${digit}`.slice(0, 6);
    setPin(next);
    setError("");
    if (next.length === 6) setTimeout(() => submit(next), 120);
  };

  const bioUnlock = async () => {
    setError("");
    setBusy(true);
    try {
      await unlockWithBiometric();
      onUnlocked();
    } catch (e) {
      setError(e?.message || "Biometric unlock failed.");
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    try {
      await resetApp();
      window.location.reload();
    } catch (e) {
      setShowReset(false);
      setError(e?.message || "Could not erase the app. Try again.");
    }
  };

  const title = isSetup
    ? step === "enter"
      ? "Create your PIN"
      : "Confirm your PIN"
    : "Enter your PIN";
  const subtitle = isSetup
    ? "This PIN protects the shop data on this device. It cannot be recovered."
    : "Unlock to open the shop.";

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-brand-800 via-brand-700 to-brand-900 px-6 pb-8 pt-16 safe-top">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/15 text-white">
          {isSetup ? <ShieldCheck className="h-8 w-8" /> : <Lock className="h-8 w-8" />}
        </div>
        <h1 className="text-center text-2xl font-bold text-white">{title}</h1>
        <p className="mt-2 max-w-xs text-center text-sm text-white/70">{subtitle}</p>

        <div className="my-8">
          <Dots length={6} filled={pin.length} />
        </div>

        {error ? (
          <p className="mb-4 max-w-xs text-center text-sm font-medium text-amber-200">{error}</p>
        ) : null}

        <Keypad onDigit={press} onDelete={() => setPin((p) => p.slice(0, -1))} disabled={busy} />

        <div className="mt-6 flex h-12 items-center justify-center">
          {busy ? <Spinner className="h-6 w-6 text-white" /> : null}
          {!busy && !isSetup && bioAvailable && bioEnabled ? (
            <button
              type="button"
              onClick={bioUnlock}
              className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-white active:bg-white/20"
            >
              <Fingerprint className="h-5 w-5" /> Use fingerprint / face
            </button>
          ) : null}
        </div>
      </div>

      {!isSetup ? (
        <button
          type="button"
          onClick={() => setShowReset(true)}
          className="mx-auto text-xs font-medium text-white/50 underline"
        >
          Forgot PIN?
        </button>
      ) : null}

      <Modal
        open={showReset}
        title="Reset the app?"
        onClose={() => setShowReset(false)}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={doReset}>
              Erase everything
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Forgetting the PIN cannot be undone. The only way back in is to erase the encrypted
          database and start again. Restore from a backup afterwards if you have one.
        </p>
      </Modal>
    </div>
  );
}
