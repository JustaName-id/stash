/// Detects two Shift presses in quick succession. Any other key press in
/// between resets the sequence, so Shift-typing (e.g. Shift+A) never triggers.
pub const THRESHOLD_MS: u64 = 350;

pub struct DoubleTapDetector {
    last_shift_ms: Option<u64>,
    last_other_ms: Option<u64>,
}

impl DoubleTapDetector {
    pub fn new() -> Self {
        Self { last_shift_ms: None, last_other_ms: None }
    }

    /// Feed a key press. Returns `true` when a double-tap completes.
    ///
    /// Shift presses inside a typing burst (within the threshold of any
    /// other key) are ignored entirely: when typing e.g. `# T`, the tap
    /// reports Shift transitions around the `3` that would otherwise look
    /// like a double-tap and hide the panel mid-typing.
    pub fn on_key_press(&mut self, is_shift: bool, now_ms: u64) -> bool {
        if !is_shift {
            self.last_other_ms = Some(now_ms);
            self.last_shift_ms = None;
            return false;
        }
        if let Some(other) = self.last_other_ms {
            if now_ms.saturating_sub(other) <= THRESHOLD_MS {
                self.last_shift_ms = None;
                return false;
            }
        }
        match self.last_shift_ms {
            Some(prev) if now_ms.saturating_sub(prev) <= THRESHOLD_MS => {
                self.last_shift_ms = None;
                true
            }
            _ => {
                self.last_shift_ms = Some(now_ms);
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggers_on_two_quick_shifts() {
        let mut d = DoubleTapDetector::new();
        assert!(!d.on_key_press(true, 0));
        assert!(d.on_key_press(true, 200));
    }

    #[test]
    fn ignores_slow_second_shift() {
        let mut d = DoubleTapDetector::new();
        assert!(!d.on_key_press(true, 0));
        assert!(!d.on_key_press(true, 400));
        // ...but that slow press starts a new sequence.
        assert!(d.on_key_press(true, 600));
    }

    #[test]
    fn other_keys_reset_and_cool_down_the_sequence() {
        let mut d = DoubleTapDetector::new();
        assert!(!d.on_key_press(true, 0));
        assert!(!d.on_key_press(false, 100)); // e.g. Shift+A
        // Shifts inside the typing burst are ignored, not candidates.
        assert!(!d.on_key_press(true, 150));
        assert!(!d.on_key_press(true, 250));
        // After the burst cools down, a deliberate double-tap works.
        assert!(!d.on_key_press(true, 600));
        assert!(d.on_key_press(true, 700));
    }

    #[test]
    fn typing_hash_then_capital_never_toggles() {
        // "# T": Shift↓, 3↓, phantom Shift press on release, Shift↓ for T.
        let mut d = DoubleTapDetector::new();
        assert!(!d.on_key_press(true, 0)); // Shift down
        assert!(!d.on_key_press(false, 80)); // '3'
        assert!(!d.on_key_press(true, 200)); // phantom press on Shift up
        assert!(!d.on_key_press(true, 350)); // Shift down for 'T'
        assert!(!d.on_key_press(false, 450)); // 'T'
    }

    #[test]
    fn does_not_retrigger_on_a_third_shift() {
        let mut d = DoubleTapDetector::new();
        assert!(!d.on_key_press(true, 0));
        assert!(d.on_key_press(true, 100));
        assert!(!d.on_key_press(true, 200));
    }
}
