-- 0004 is the sole frozen Unicode/blank-text policy. Keep varchar limits and NOT NULL.
-- 0003's locale classes and broad U+2060..U+206F range also rejected permitted U+2065.
-- Only retire the three legacy text checks; identity, revision, time, FK and audit checks remain.
ALTER TABLE qf.product DROP CONSTRAINT product_title_check;
ALTER TABLE qf.category DROP CONSTRAINT category_name_check;
ALTER TABLE qf.tag DROP CONSTRAINT tag_name_check;
