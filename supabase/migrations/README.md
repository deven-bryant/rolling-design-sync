# Supabase migrations

SQL schema for the change-sync service. Files follow the Supabase CLI
convention `<YYYYMMDDHHMMSS>_<name>.sql` and apply in filename order.
The data model is specified in `docs/architecture.md` ("Data model").

## Apply

With the Supabase CLI (linked project):

```bash
supabase db push
```

Or open the Supabase dashboard → SQL editor and paste each file in order.

## Verify locally

```bash
docker run -d --name fds-pg -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16-alpine
for f in supabase/migrations/*.sql; do
  docker exec -i fds-pg psql -v ON_ERROR_STOP=1 -U postgres < "$f"
done
```
