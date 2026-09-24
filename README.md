# Student Support & Ticket Management App

A simple college support portal built with Node.js, Express, SQLite, HTML, CSS, and JavaScript.

## Features

- Role-based login for Student, Staff, and Admin
- Ticket creation, status updates, and assignment
- Comments and activity history
- SLA due dates and ageing indicators
- SLA breach and escalation logic
- Dashboard statistics and basic reports using Chart.js
- Responsive admin-style interface

## Tech Stack

- Node.js
- Express.js
- SQLite3
- HTML/CSS/JavaScript
- Chart.js (CDN)

## Run the app

1. Install dependencies:
   npm install

2. Start the server:
   node server.js

3. Open in browser:
   http://localhost:3000

## Demo accounts

- Student: student@college.edu / student123
- Staff: staff@college.edu / staff123
- Admin: admin@college.edu / admin123

## Project structure

- server.js — Express server and SQLite setup
- public/ — static HTML, CSS, and JavaScript frontend pages
- data/college_support.db — SQLite database created automatically on first run

## Notes

The database is initialized automatically when the server starts. If the SQLite file does not exist, it will be created with the required tables and seed users.
