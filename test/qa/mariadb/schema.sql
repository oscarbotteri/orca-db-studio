-- The SQLite shop (seed-sqlite.ts) with MariaDB types. Rows come from seed-mariadb.ts output.
CREATE TABLE customers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32),
  created_at DATETIME NOT NULL
);
CREATE TABLE categories (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  category_id INT NOT NULL,
  price_cents INT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories (id)
);
CREATE TABLE orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  placed_at DATETIME NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers (id)
);
CREATE TABLE order_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  FOREIGN KEY (product_id) REFERENCES products (id)
);
CREATE VIEW order_totals AS
  SELECT o.id AS order_id, o.customer_id, o.status, sum(i.quantity * i.unit_price_cents) AS total_cents
  FROM orders o JOIN order_items i ON i.order_id = o.id
  GROUP BY o.id, o.customer_id, o.status;
CREATE TABLE events (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  INDEX events_customer_id (customer_id)
);
CREATE TABLE type_samples (
  id INT PRIMARY KEY AUTO_INCREMENT,
  label VARCHAR(255) NOT NULL,
  text_value LONGTEXT,
  big_number BIGINT,
  json_value JSON,
  zoned_at DATETIME(3),
  blob_value BLOB
);
