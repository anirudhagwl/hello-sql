import os
import io
import csv
import json
import sqlite3
import tempfile
from flask import Flask, render_template, request, jsonify, send_file, session
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24))
app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', os.path.join(os.path.dirname(__file__), 'uploads'))
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'db', 'sqlite', 'sqlite3'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_db_path():
    db_path = session.get('db_path')
    if db_path and os.path.exists(db_path):
        return db_path
    return None


def get_connection():
    db_path = get_db_path()
    if not db_path:
        return None
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_database():
    if 'database' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['database']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Allowed: .db, .sqlite, .sqlite3'}), 400

    filename = secure_filename(file.filename)
    # Use a unique name to avoid conflicts
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{os.urandom(8).hex()}_{filename}")
    file.save(filepath)

    # Remove old database if exists
    old_path = session.get('db_path')
    if old_path and os.path.exists(old_path):
        os.remove(old_path)

    session['db_path'] = filepath

    # Validate it's a real SQLite database
    try:
        conn = sqlite3.connect(filepath)
        conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        conn.close()
    except Exception:
        os.remove(filepath)
        return jsonify({'error': 'Invalid SQLite database file'}), 400

    return jsonify({'success': True, 'filename': filename})


@app.route('/tables', methods=['GET'])
def get_tables():
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        tables = [row['name'] for row in cursor.fetchall()]
        return jsonify({'tables': tables})
    finally:
        conn.close()


@app.route('/columns/<table_name>', methods=['GET'])
def get_columns(table_name):
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        # Validate table name exists
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
        )
        if not cursor.fetchone():
            return jsonify({'error': 'Table not found'}), 404

        cursor = conn.execute(f'PRAGMA table_info("{table_name}")')
        columns = []
        for row in cursor.fetchall():
            columns.append({
                'name': row['name'],
                'type': row['type'],
                'notnull': bool(row['notnull']),
                'pk': bool(row['pk']),
                'default': row['dflt_value']
            })
        return jsonify({'columns': columns})
    finally:
        conn.close()


@app.route('/foreign_keys/<table_name>', methods=['GET'])
def get_foreign_keys(table_name):
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        cursor = conn.execute(f'PRAGMA foreign_key_list("{table_name}")')
        fks = []
        for row in cursor.fetchall():
            fks.append({
                'from_column': row['from'],
                'to_table': row['table'],
                'to_column': row['to']
            })
        return jsonify({'foreign_keys': fks})
    finally:
        conn.close()


@app.route('/execute', methods=['POST'])
def execute_query():
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    data = request.json
    sql = data.get('sql', '').strip()

    if not sql:
        return jsonify({'error': 'No SQL query provided'}), 400

    # Only allow SELECT queries for safety (also allow WITH for CTEs, and parens for set operations)
    check_sql = sql.lstrip('( \t\n')
    if not check_sql.upper().startswith('SELECT') and not check_sql.upper().startswith('WITH'):
        return jsonify({'error': 'Only SELECT queries are allowed'}), 400

    try:
        cursor = conn.execute(sql)
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = [list(row) for row in cursor.fetchall()]

        return jsonify({
            'columns': columns,
            'rows': rows,
            'row_count': len(rows),
            'sql': sql
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()


@app.route('/export', methods=['POST'])
def export_results():
    data = request.json
    columns = data.get('columns', [])
    rows = data.get('rows', [])
    fmt = data.get('format', 'csv')

    if fmt == 'csv':
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(columns)
        writer.writerows(rows)
        content = output.getvalue()
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype='text/csv',
            as_attachment=True,
            download_name='query_results.csv'
        )

    elif fmt == 'tsv':
        output = io.StringIO()
        writer = csv.writer(output, delimiter='\t')
        writer.writerow(columns)
        writer.writerows(rows)
        content = output.getvalue()
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype='text/tab-separated-values',
            as_attachment=True,
            download_name='query_results.tsv'
        )

    elif fmt == 'json':
        result = []
        for row in rows:
            result.append(dict(zip(columns, row)))
        content = json.dumps(result, indent=2, default=str)
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype='application/json',
            as_attachment=True,
            download_name='query_results.json'
        )

    elif fmt == 'txt':
        lines = []
        # Calculate column widths
        widths = [len(str(c)) for c in columns]
        for row in rows:
            for i, val in enumerate(row):
                widths[i] = max(widths[i], len(str(val)))

        # Header
        header = ' | '.join(str(c).ljust(widths[i]) for i, c in enumerate(columns))
        separator = '-+-'.join('-' * w for w in widths)
        lines.append(header)
        lines.append(separator)

        # Rows
        for row in rows:
            line = ' | '.join(str(v).ljust(widths[i]) for i, v in enumerate(row))
            lines.append(line)

        content = '\n'.join(lines)
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype='text/plain',
            as_attachment=True,
            download_name='query_results.txt'
        )

    elif fmt == 'sql':
        lines = []
        table_name = data.get('table_name', 'results')
        for row in rows:
            values = []
            for v in row:
                if v is None:
                    values.append('NULL')
                elif isinstance(v, (int, float)):
                    values.append(str(v))
                else:
                    values.append("'" + str(v).replace("'", "''") + "'")
            cols = ', '.join(columns)
            vals = ', '.join(values)
            lines.append(f"INSERT INTO {table_name} ({cols}) VALUES ({vals});")
        content = '\n'.join(lines)
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype='application/sql',
            as_attachment=True,
            download_name='query_results.sql'
        )

    elif fmt == 'xml':
        lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<results>']
        for row in rows:
            lines.append('  <row>')
            for i, col in enumerate(columns):
                val = row[i] if row[i] is not None else ''
                lines.append(f'    <{col}>{val}</{col}>')
            lines.append('  </row>')
        lines.append('</results>')
        content = '\n'.join(lines)
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype='application/xml',
            as_attachment=True,
            download_name='query_results.xml'
        )

    return jsonify({'error': 'Unsupported format'}), 400


@app.route('/schema', methods=['GET'])
def get_schema():
    """Return full schema: tables with columns, row counts, and foreign keys."""
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        tables = [row['name'] for row in cursor.fetchall()]

        schema = {}
        for table in tables:
            # Columns
            col_cursor = conn.execute(f'PRAGMA table_info("{table}")')
            columns = []
            for r in col_cursor.fetchall():
                columns.append({
                    'name': r['name'], 'type': r['type'],
                    'notnull': bool(r['notnull']), 'pk': bool(r['pk']),
                    'default': r['dflt_value']
                })

            # Row count
            count_cursor = conn.execute(f'SELECT COUNT(*) as cnt FROM "{table}"')
            row_count = count_cursor.fetchone()['cnt']

            # Foreign keys
            fk_cursor = conn.execute(f'PRAGMA foreign_key_list("{table}")')
            fks = []
            for r in fk_cursor.fetchall():
                fks.append({
                    'from_column': r['from'],
                    'to_table': r['table'],
                    'to_column': r['to']
                })

            schema[table] = {
                'columns': columns,
                'row_count': row_count,
                'foreign_keys': fks
            }

        return jsonify({'schema': schema})
    finally:
        conn.close()


@app.route('/preview/<table_name>', methods=['GET'])
def preview_table(table_name):
    """Return first 5 rows of a table for quick preview."""
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
        )
        if not cursor.fetchone():
            return jsonify({'error': 'Table not found'}), 404

        cursor = conn.execute(f'SELECT * FROM "{table_name}" LIMIT 5')
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = [list(row) for row in cursor.fetchall()]
        return jsonify({'columns': columns, 'rows': rows})
    finally:
        conn.close()


@app.route('/sample_data')
def sample_data():
    """Return first 3 rows from every table for AI context."""
    db_path = session.get('db_path')
    if not db_path:
        return jsonify({'error': 'No database loaded'}), 400

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        tables = [r['name'] for r in cursor.fetchall()]
        result = {}
        for table in tables:
            try:
                rows = cursor.execute(f'SELECT * FROM "{table}" LIMIT 3').fetchall()
                result[table] = [dict(r) for r in rows]
            except Exception:
                result[table] = []
        conn.close()
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/sample_db', methods=['POST'])
def create_sample_db():
    """Create a sample database for testing."""
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{os.urandom(8).hex()}_sample.db")

    conn = sqlite3.connect(filepath)
    c = conn.cursor()

    c.executescript('''
        CREATE TABLE departments (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            location TEXT
        );

        CREATE TABLE employees (
            id INTEGER PRIMARY KEY,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT,
            department_id INTEGER,
            salary REAL,
            hire_date TEXT,
            FOREIGN KEY (department_id) REFERENCES departments(id)
        );

        CREATE TABLE projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            budget REAL,
            department_id INTEGER,
            start_date TEXT,
            FOREIGN KEY (department_id) REFERENCES departments(id)
        );

        CREATE TABLE employee_projects (
            employee_id INTEGER,
            project_id INTEGER,
            role TEXT,
            PRIMARY KEY (employee_id, project_id),
            FOREIGN KEY (employee_id) REFERENCES employees(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        INSERT INTO departments VALUES (1, 'Engineering', 'Building A');
        INSERT INTO departments VALUES (2, 'Marketing', 'Building B');
        INSERT INTO departments VALUES (3, 'Sales', 'Building C');
        INSERT INTO departments VALUES (4, 'HR', 'Building A');
        INSERT INTO departments VALUES (5, 'Finance', 'Building D');

        INSERT INTO employees VALUES (1, 'Alice', 'Johnson', 'alice@company.com', 1, 95000, '2020-01-15');
        INSERT INTO employees VALUES (2, 'Bob', 'Smith', 'bob@company.com', 1, 88000, '2019-06-20');
        INSERT INTO employees VALUES (3, 'Carol', 'Williams', 'carol@company.com', 2, 72000, '2021-03-10');
        INSERT INTO employees VALUES (4, 'David', 'Brown', 'david@company.com', 3, 68000, '2020-11-05');
        INSERT INTO employees VALUES (5, 'Eve', 'Davis', 'eve@company.com', 1, 102000, '2018-08-22');
        INSERT INTO employees VALUES (6, 'Frank', 'Miller', 'frank@company.com', 2, 75000, '2022-01-08');
        INSERT INTO employees VALUES (7, 'Grace', 'Wilson', 'grace@company.com', 3, 71000, '2021-07-14');
        INSERT INTO employees VALUES (8, 'Henry', 'Moore', 'henry@company.com', 4, 65000, '2023-02-01');
        INSERT INTO employees VALUES (9, 'Ivy', 'Taylor', 'ivy@company.com', 5, 82000, '2020-09-30');
        INSERT INTO employees VALUES (10, 'Jack', 'Anderson', 'jack@company.com', 1, 91000, '2019-12-12');

        INSERT INTO projects VALUES (1, 'Website Redesign', 150000, 1, '2024-01-01');
        INSERT INTO projects VALUES (2, 'Mobile App', 200000, 1, '2024-03-15');
        INSERT INTO projects VALUES (3, 'Q1 Campaign', 50000, 2, '2024-01-10');
        INSERT INTO projects VALUES (4, 'CRM Integration', 80000, 3, '2024-02-20');
        INSERT INTO projects VALUES (5, 'Benefits Portal', 30000, 4, '2024-04-01');

        INSERT INTO employee_projects VALUES (1, 1, 'Lead');
        INSERT INTO employee_projects VALUES (2, 1, 'Developer');
        INSERT INTO employee_projects VALUES (5, 2, 'Lead');
        INSERT INTO employee_projects VALUES (10, 2, 'Developer');
        INSERT INTO employee_projects VALUES (1, 2, 'Reviewer');
        INSERT INTO employee_projects VALUES (3, 3, 'Lead');
        INSERT INTO employee_projects VALUES (6, 3, 'Designer');
        INSERT INTO employee_projects VALUES (4, 4, 'Lead');
        INSERT INTO employee_projects VALUES (7, 4, 'Analyst');
        INSERT INTO employee_projects VALUES (8, 5, 'Lead');
    ''')

    conn.commit()
    conn.close()

    # Remove old database if exists
    old_path = session.get('db_path')
    if old_path and os.path.exists(old_path):
        os.remove(old_path)

    session['db_path'] = filepath
    return jsonify({'success': True, 'filename': 'sample.db'})


@app.route('/alter_column_type', methods=['POST'])
def alter_column_type():
    """Change a column's datatype using the recreate-table pattern."""
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    data = request.json
    table = data.get('table', '')
    column = data.get('column', '')
    new_type = data.get('new_type', '').upper()

    allowed_types = {'TEXT', 'INTEGER', 'REAL', 'NUMERIC', 'BLOB'}
    if new_type not in allowed_types:
        return jsonify({'error': f'Invalid type. Allowed: {", ".join(allowed_types)}'}), 400

    try:
        # Validate table exists
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        )
        if not cursor.fetchone():
            return jsonify({'error': 'Table not found'}), 404

        # Get current schema
        col_cursor = conn.execute(f'PRAGMA table_info("{table}")')
        columns = col_cursor.fetchall()
        col_names = [r['name'] for r in columns]

        if column not in col_names:
            return jsonify({'error': 'Column not found'}), 404

        # Get foreign keys
        fk_cursor = conn.execute(f'PRAGMA foreign_key_list("{table}")')
        fks = fk_cursor.fetchall()

        # Build new CREATE TABLE statement
        col_defs = []
        pk_cols = []
        for r in columns:
            col_type = new_type if r['name'] == column else (r['type'] or 'TEXT')
            notnull = ' NOT NULL' if r['notnull'] else ''
            default = f" DEFAULT {r['dflt_value']}" if r['dflt_value'] is not None else ''
            pk = ''
            if r['pk']:
                pk_cols.append(r['name'])
            col_defs.append(f'"{r["name"]}" {col_type}{notnull}{default}')

        # Add primary key constraint
        if pk_cols:
            if len(pk_cols) == 1:
                # Inline PK - rebuild the column def
                for i, r in enumerate(columns):
                    if r['name'] == pk_cols[0]:
                        col_type = new_type if r['name'] == column else (r['type'] or 'TEXT')
                        notnull = ' NOT NULL' if r['notnull'] else ''
                        default = f" DEFAULT {r['dflt_value']}" if r['dflt_value'] is not None else ''
                        col_defs[i] = f'"{r["name"]}" {col_type} PRIMARY KEY{notnull}{default}'
            else:
                col_defs.append(f'PRIMARY KEY ({", ".join(pk_cols)})')

        # Add foreign key constraints
        for fk in fks:
            col_defs.append(f'FOREIGN KEY ("{fk["from"]}") REFERENCES "{fk["table"]}"("{fk["to"]}")')

        temp_name = f'_temp_alter_{table}'
        col_list = ', '.join(f'"{c}"' for c in col_names)

        conn.execute('BEGIN TRANSACTION')
        conn.execute(f'CREATE TABLE "{temp_name}" ({", ".join(col_defs)})')
        conn.execute(f'INSERT INTO "{temp_name}" ({col_list}) SELECT {col_list} FROM "{table}"')
        conn.execute(f'DROP TABLE "{table}"')
        conn.execute(f'ALTER TABLE "{temp_name}" RENAME TO "{table}"')
        conn.execute('COMMIT')

        return jsonify({'success': True})
    except Exception as e:
        try:
            conn.execute('ROLLBACK')
        except Exception:
            pass
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()


@app.route('/set_key', methods=['POST'])
def set_key():
    """Toggle primary key on a column using the recreate-table pattern."""
    conn = get_connection()
    if not conn:
        return jsonify({'error': 'No database loaded'}), 400

    data = request.json
    table = data.get('table', '')
    column = data.get('column', '')
    key_type = data.get('key_type', 'pk')

    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        )
        if not cursor.fetchone():
            return jsonify({'error': 'Table not found'}), 404

        col_cursor = conn.execute(f'PRAGMA table_info("{table}")')
        columns = col_cursor.fetchall()
        col_names = [r['name'] for r in columns]

        if column not in col_names:
            return jsonify({'error': 'Column not found'}), 404

        # Get foreign keys
        fk_cursor = conn.execute(f'PRAGMA foreign_key_list("{table}")')
        fks = fk_cursor.fetchall()

        # Determine new PK status - toggle
        target_col = next(r for r in columns if r['name'] == column)
        new_is_pk = not bool(target_col['pk'])

        col_defs = []
        pk_cols = []
        for r in columns:
            col_type = r['type'] or 'TEXT'
            notnull = ' NOT NULL' if r['notnull'] else ''
            default = f" DEFAULT {r['dflt_value']}" if r['dflt_value'] is not None else ''

            if r['name'] == column:
                if new_is_pk:
                    pk_cols.append(r['name'])
            elif r['pk']:
                pk_cols.append(r['name'])

            col_defs.append(f'"{r["name"]}" {col_type}{notnull}{default}')

        if pk_cols:
            if len(pk_cols) == 1:
                for i, r in enumerate(columns):
                    if r['name'] == pk_cols[0]:
                        col_type = r['type'] or 'TEXT'
                        notnull = ' NOT NULL' if r['notnull'] else ''
                        default = f" DEFAULT {r['dflt_value']}" if r['dflt_value'] is not None else ''
                        col_defs[i] = f'"{r["name"]}" {col_type} PRIMARY KEY{notnull}{default}'
            else:
                col_defs.append(f'PRIMARY KEY ({", ".join(pk_cols)})')

        for fk in fks:
            col_defs.append(f'FOREIGN KEY ("{fk["from"]}") REFERENCES "{fk["table"]}"("{fk["to"]}")')

        temp_name = f'_temp_key_{table}'
        col_list = ', '.join(f'"{c}"' for c in col_names)

        conn.execute('BEGIN TRANSACTION')
        conn.execute(f'CREATE TABLE "{temp_name}" ({", ".join(col_defs)})')
        conn.execute(f'INSERT INTO "{temp_name}" ({col_list}) SELECT {col_list} FROM "{table}"')
        conn.execute(f'DROP TABLE "{table}"')
        conn.execute(f'ALTER TABLE "{temp_name}" RENAME TO "{table}"')
        conn.execute('COMMIT')

        return jsonify({'success': True})
    except Exception as e:
        try:
            conn.execute('ROLLBACK')
        except Exception:
            pass
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()


if __name__ == '__main__':
    app.run(debug=True, port=5001)
