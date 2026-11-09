"use client";

import { useState } from "react";

// Password box with a show/hide eye, so people can check what they typed.
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="pwwrap">
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="pweye" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} title={show ? "Hide password" : "Show password"} onMouseDown={(e) => e.preventDefault()} /* don't steal focus: a blur would pop validation errors and shift the form */ onClick={() => setShow((s) => !s)}>
        <span className="t-icon-swap" data-state={show ? "b" : "a"} aria-hidden="true">
          <svg className="t-icon" data-icon="a" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="3" /></svg>
          <svg className="t-icon" data-icon="b" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0112 6c5 0 9 6 9 6a15.6 15.6 0 01-3.2 3.7M6.5 7.6C4.3 9.2 3 12 3 12s4 6 9 6c1.5 0 2.9-.4 4.100-1M9.9 9.9a3 3 0 004.2 4.2" /></svg>
        </span>
      </button>
    </span>
  );
}
