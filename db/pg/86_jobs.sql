-- SQL Server Agent stand-in: the application asks `msdb..SysJobs` whether its scheduled jobs (backup, posting, CRS sending ...) are enabled.
-- PostgreSQL has no Agent: a job is known by name and disabled until the user enables it in the preferences (the schedule itself is run by the operating system's task scheduler).
CREATE TABLE IF NOT EXISTS dbo.sysjobs (name citext PRIMARY KEY, enabled smallint NOT NULL DEFAULT 0);
