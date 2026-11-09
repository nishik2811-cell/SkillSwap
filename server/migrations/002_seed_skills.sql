INSERT INTO categories (name) VALUES ('Tech'),('Music'),('Design'),('Languages'),('Creative'),('Lifestyle');
INSERT INTO skills (category_id, name) SELECT c.id, s.name FROM categories c JOIN (
  SELECT 'Tech' cat,'Python' name UNION ALL SELECT 'Tech','JavaScript' UNION ALL SELECT 'Tech','Data Analysis'
  UNION ALL SELECT 'Music','Guitar' UNION ALL SELECT 'Music','Music Theory' UNION ALL SELECT 'Music','Piano'
  UNION ALL SELECT 'Design','UI/UX Design' UNION ALL SELECT 'Design','Canva Design'
  UNION ALL SELECT 'Languages','Spanish' UNION ALL SELECT 'Languages','Hindi' UNION ALL SELECT 'Languages','English'
  UNION ALL SELECT 'Creative','Photography' UNION ALL SELECT 'Creative','Video Editing'
  UNION ALL SELECT 'Lifestyle','Cooking' UNION ALL SELECT 'Lifestyle','Fitness'
) s ON s.cat = c.name;
