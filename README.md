# Hello SQL

A visual SQL query builder that lets you learn and write SQL without memorizing syntax. Point, click, and watch the query write itself.

Built by [Anirudh Agarwal](https://github.com/anirudhagwl).

## What is this?

Hello SQL is a web app that turns SQL into something visual. Instead of staring at a blank editor trying to remember whether it's `JOIN ON` or `JOIN WHERE`, you just pick a table, check some columns, add a filter, and the SQL builds itself in real time right next to you.

There's also an AI assistant. Type what you want in plain English and it writes the query for you. Then the visual builder breaks it apart so you can see how each piece works.

## Features

**Visual Query Builder**
- Point-and-click interface for SELECT, JOIN, WHERE, GROUP BY, ORDER BY, HAVING, LIMIT
- Real-time SQL preview that updates as you build
- Table previews with sample data
- Column type badges and primary key indicators

**Advanced SQL**
- Window functions (ROW_NUMBER, RANK, LAG, LEAD, etc.)
- Common Table Expressions (CTEs / WITH clause)
- Set operations (UNION, INTERSECT, EXCEPT)
- Aggregate functions with GROUP BY
- String and date functions
- DISTINCT, computed columns, subqueries

**AI-Powered**
- Ask questions in plain English, get SQL instantly
- Powered by Qwen AI via Hugging Face
- Works with your actual database schema for accurate queries

**Data Tools**
- Upload your own SQLite databases (.db, .sqlite, .sqlite3)
- Built-in sample database to get started immediately
- Export results to CSV, JSON, XML, TSV, SQL INSERT statements, or plain text
- Filter and search through results
- Sortable columns, pagination
- Copy results or queries with one click

**Workflow**
- Save and load queries by name
- Full query history with timestamps and row counts
- Undo/redo navigation between previously run queries
- Visual Builder mode and raw SQL Editor mode
- Keyboard shortcuts (Ctrl+Enter to run, Ctrl+S to save, Ctrl+H for history)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, Flask |
| Database | SQLite3 |
| Frontend | Vanilla JavaScript, HTML, CSS |
| AI | Hugging Face API, Qwen2.5-Coder-32B-Instruct |
| Fonts | Inter, JetBrains Mono |
| Deployment | Gunicorn, Render |

## Getting Started

### Prerequisites

- Python 3.8+
- pip

### Installation

```bash
# Clone the repository
git clone https://github.com/anirudhagwl/hello-sql.git
cd hello-sql

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

The app will be available at `http://localhost:5001`.

### Environment Variables

Create a `.env` file in the project root (optional, for AI features):

```
HF_API_KEY=your_hugging_face_api_key
```

You can get a free API key from [Hugging Face](https://huggingface.co/settings/tokens).

The app works without an API key. You just won't be able to use the Ask AI feature.

## Usage

1. Open the app in your browser
2. Click **Sample DB** to load the built-in database, or **Upload DB** to use your own SQLite file
3. Pick a table from the FROM dropdown
4. Check the columns you want, add filters, joins, sorting
5. Watch the SQL build in real time
6. Click **Run Query** to see results

Or just type what you want in the Ask AI bar and let it write the query for you.

## Project Structure

```
hello-sql/
  app.py                 # Flask backend with all API routes
  requirements.txt       # Python dependencies
  templates/
    index.html           # Main page
  static/
    css/style.css         # Styling (dark theme, glassmorphism)
    js/app.js             # Frontend logic (visual builder, parser, AI)
```

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Serve the main page |
| POST | `/upload` | Upload a SQLite database |
| POST | `/sample_db` | Load the built-in sample database |
| GET | `/schema` | Get full database schema with row counts |
| GET | `/tables` | List all tables |
| GET | `/columns/<table>` | Get column definitions for a table |
| GET | `/foreign_keys/<table>` | Get foreign key relationships |
| GET | `/preview/<table>` | Preview first 5 rows of a table |
| POST | `/execute` | Run a SELECT query (read-only) |
| POST | `/export` | Export results in various formats |
| POST | `/ai/ask` | Ask AI to generate a SQL query |
| GET | `/sample_data` | Get sample rows from all tables (for AI context) |

## License

MIT

## Contributing

Contributions are welcome. Open an issue or submit a pull request.

If you find this useful, consider giving it a star on GitHub.
