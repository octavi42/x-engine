# Scheduled Task Prompt

This is the exact prompt used in the Claude Code scheduled task.
Keep it version-controlled here — copy-paste into the scheduler when updating.

---

Run the daily X content generation workflow.

1. Read config/voice.md and config/projects.md
2. For each project, search GitHub for recent commits and activity
3. Search the web for what's trending in dev/AI/startup Twitter today
4. Append trending findings to sources/trending-log.md with today's date as header
5. Read sources/raw-ideas.md for any new ideas I've added
6. Generate 5 post drafts following the rules in CLAUDE.md:
   - 1 building in public (pick the most active project)
   - 1 trending topic reaction
   - 1 technical tip from a project's codebase
   - 1 engagement question
   - 1 thread hook with outline
7. Save to drafts/YYYY-MM-DD.md and commit with message "daily drafts YYYY-MM-DD"
