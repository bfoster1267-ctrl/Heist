import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { click } from "../sound";
import { buzz } from "../haptics";

const STORAGE_KEY = "heist.cookieConsent";

export function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      // ignore storage blocks
    }
  }, []);

  const accept = () => {
    click();
    buzz("tap");
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="cookie-banner"
          role="region"
          aria-label="Cookie and data notice"
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          <div className="cookie-banner-text">
            <span>
              We use essential cookies and local storage to run the game, remember your progress, and analyze gameplay. By playing, you agree to our{" "}
              <a href="./terms.html" target="_blank" rel="noreferrer">
                Terms
              </a>{" "}
              and{" "}
              <a href="./privacy.html" target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
              .
            </span>
          </div>
          <button type="button" className="btn small gold cookie-banner-btn" onClick={accept}>
            Got it
          </button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
