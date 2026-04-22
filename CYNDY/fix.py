import re

with open('schema.sql', 'r', encoding='utf-8') as f:
    sql = f.read()

# 1. Enums
def enum_repl(m):
    return f"DO $$ BEGIN\n    {m.group(0)}\nEXCEPTION\n    WHEN duplicate_object THEN null;\nEND $$;"

sql = re.sub(r'CREATE TYPE\s+\w+\s+AS\s+ENUM\s*\([^;]+;', enum_repl, sql)

# 2. Tables
sql = re.sub(r'CREATE TABLE\s+(\w+)', r'CREATE TABLE IF NOT EXISTS \1', sql)

# 3. Policies
def policy_repl(m):
    pol_name = m.group(1)
    table_name = m.group(2)
    return f'DROP POLICY IF EXISTS "{pol_name}" ON {table_name};\n{m.group(0)}'

sql = re.sub(r'CREATE POLICY\s+"([^"]+)"\s+ON\s+(\w+)', policy_repl, sql)

with open('schema.sql', 'w', encoding='utf-8') as f:
    f.write(sql)
