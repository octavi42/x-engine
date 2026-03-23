# Scheduled Task Prompt

This is the exact prompt used in the Claude Code scheduled task.
Keep it version-controlled here — copy-paste into the scheduler when updating.

---

Always cd into the x-engine repo directory first.
git checkout main && git pull origin main before doing anything.

Do NOT run npx skillfish add or install any skills.
Everything you need is already in CLAUDE.md and config/.

Run the daily X content generation workflow.

1. Read config/voice.md, config/projects.md, and sources/x-profile.md
2. Sync my X profile:
   a. Search the web for recent posts from @octavicristea
   b. Read posted/archive.md for engagement data
   c. Scan the last 14 days of files in drafts/
   d. Update sources/x-profile.md with latest posts, topics covered, content gaps, and current narrative
3. For each project, search GitHub for recent commits and activity
4. Search the web for what's trending in dev/AI/startup Twitter today
5. Append trending findings to sources/trending-log.md with today's date as header
6. Read sources/raw-ideas.md for any new ideas I've added
7. Generate 5 post drafts following the rules in CLAUDE.md:
   - 1 building in public (pick the most active project)
   - 1 trending topic reaction
   - 1 technical tip from a project's codebase
   - 1 engagement question
   - 1 thread hook with outline
   At least one draft must address a content gap from x-profile.md. Never repeat a topic from the last 7 days.
8. Verify every single tweet is under 280 characters. Rewrite any that exceed the limit.
9. Save to drafts/YYYY-MM-DD.md, update sources/trending-log.md, update sources/x-profile.md
10. git add, commit with message "daily drafts YYYY-MM-DD" (nothing else in the message), then git push origin main.

The push step is critical — without it all work is lost when the session ends.
Always push to main. Never use master.
