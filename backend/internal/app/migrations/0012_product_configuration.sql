CREATE TABLE product_configuration (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    age INTEGER NOT NULL CHECK (age BETWEEN 1 AND 150),
    invitation JSONB NOT NULL,
    image_size_mb INTEGER NOT NULL CHECK (image_size_mb BETWEEN 1 AND 1024),
    video_size_mb INTEGER NOT NULL CHECK (video_size_mb BETWEEN 1 AND 1024)
);
