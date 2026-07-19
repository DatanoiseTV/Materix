// Confirmation shown before opening a link that failed the safety heuristics.
// Offers to permanently trust the domain ("don't ask again").

import { useState } from "react";
import { Modal } from "./Modal";
import { IconAlert } from "./Icons";
import { trustDomain, openExternal, type LinkAssessment } from "../linkSafety";

export function LinkWarning({ assessment, onClose }: { assessment: LinkAssessment; onClose: () => void }) {
  const [trust, setTrust] = useState(false);

  const open = () => {
    if (trust && assessment.host) trustDomain(assessment.host);
    openExternal(assessment.href);
    onClose();
  };

  return (
    <Modal
      title="Open this link?"
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" onClick={open}>
            Open anyway
          </button>
        </>
      }
    >
      <div className="link-warning">
        <div className="link-warning-icon">
          <IconAlert size={22} />
        </div>
        <div className="link-warning-url" title={assessment.href}>
          {assessment.href}
        </div>
        <ul className="link-warning-reasons">
          {assessment.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {assessment.host && (
          <label className="link-warning-trust">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            Don&apos;t ask again for <strong>{assessment.host}</strong>
          </label>
        )}
      </div>
    </Modal>
  );
}
