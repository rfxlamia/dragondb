#!/usr/bin/env bash
# Brand-design enforcement: auto-load the creative brief at session start.
# Prints nothing and exits 0 when no brief exists, so non-brand projects are unaffected.
BRIEF="$CLAUDE_PROJECT_DIR/docs/pocket/rule/creative-brief.md"
if [ -f "$BRIEF" ]; then
  cat <<'EOF'
[brand-design] This project has a creative brief at docs/pocket/rule/creative-brief.md.
It is the design-system authority. Before planning or developing ANY UI/UX, load and obey it.
No color, type, spacing, or component decision may be made without consulting the brief.
EOF
fi
exit 0
