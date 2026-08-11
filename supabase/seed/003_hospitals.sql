-- Seed: starter hospital list
--
-- GENERATED FILE. Regenerate with:  node scripts/build-hospital-seed.mjs
--
-- Names are curated by hand. Positions come from Nominatim (OpenStreetMap,
-- ODbL) and every one was checked to be within 60km of its district centre.
-- 42 hospital(s) could not be placed and have a NULL position; they still
-- appear in the dropdown, and an admin can set the pin from master data.
--
-- This is a starting point, not a register. Add your own with plain INSERTs or
-- through the admin panel.

insert into public.hospitals (name_en, name_bn, district_id, lat, lng) values
  ('Dhaka Medical College Hospital', 'ঢাকা মেডিকেল কলেজ হাসপাতাল', 1, NULL, NULL),
  ('Bangabandhu Sheikh Mujib Medical University', 'বঙ্গবন্ধু শেখ মুজিব মেডিকেল বিশ্ববিদ্যালয়', 1, NULL, NULL),
  ('Sir Salimullah Medical College Mitford Hospital', 'স্যার সলিমুল্লাহ মেডিকেল কলেজ মিটফোর্ড হাসপাতাল', 1, NULL, NULL),
  ('Shaheed Suhrawardy Medical College Hospital', 'শহীদ সোহরাওয়ার্দী মেডিকেল কলেজ হাসপাতাল', 1, NULL, NULL),
  ('Mugda Medical College Hospital', 'মুগদা মেডিকেল কলেজ হাসপাতাল', 1, NULL, NULL),
  ('Kurmitola General Hospital', 'কুর্মিটোলা জেনারেল হাসপাতাল', 1, NULL, NULL),
  ('National Institute of Cardiovascular Diseases', 'জাতীয় হৃদরোগ ইনস্টিটিউট', 1, NULL, NULL),
  ('National Institute of Traumatology and Orthopaedic Rehabilitation', 'পঙ্গু হাসপাতাল', 1, NULL, NULL),
  ('Dhaka Shishu Hospital', 'ঢাকা শিশু হাসপাতাল', 1, NULL, NULL),
  ('BIRDEM General Hospital', 'বারডেম জেনারেল হাসপাতাল', 1, NULL, NULL),
  ('Holy Family Red Crescent Medical College Hospital', 'হলি ফ্যামিলি রেড ক্রিসেন্ট মেডিকেল কলেজ হাসপাতাল', 1, NULL, NULL),
  ('Square Hospital', 'স্কয়ার হাসপাতাল', 1, NULL, NULL),
  ('United Hospital Dhaka', 'ইউনাইটেড হাসপাতাল', 1, NULL, NULL),
  ('Evercare Hospital Dhaka', 'এভারকেয়ার হাসপাতাল ঢাকা', 1, NULL, NULL),
  ('Ibn Sina Specialized Hospital Dhanmondi', 'ইবনে সিনা স্পেশালাইজড হাসপাতাল', 1, NULL, NULL),
  ('Popular Medical College Hospital Dhanmondi', 'পপুলার মেডিকেল কলেজ হাসপাতাল', 1, NULL, NULL),
  ('Central Hospital Dhanmondi', 'সেন্ট্রাল হাসপাতাল', 1, NULL, NULL),
  ('Bangladesh Medical College Hospital', 'বাংলাদেশ মেডিকেল কলেজ হাসপাতাল', 1, NULL, NULL),
  ('Islami Bank Central Hospital Kakrail', 'ইসলামী ব্যাংক কেন্দ্রীয় হাসপাতাল', 1, NULL, NULL),
  ('Chittagong Medical College Hospital', 'চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল', 43, NULL, NULL),
  ('Chattogram General Hospital', 'চট্টগ্রাম জেনারেল হাসপাতাল', 43, NULL, NULL),
  ('Chittagong Maa O Shishu Hospital', 'চট্টগ্রাম মা ও শিশু হাসপাতাল', 43, NULL, NULL),
  ('Imperial Hospital Chattogram', 'ইম্পেরিয়াল হাসপাতাল', 43, NULL, NULL),
  ('Evercare Hospital Chattogram', 'এভারকেয়ার হাসপাতাল চট্টগ্রাম', 43, NULL, NULL),
  ('Centre for Specialized Care and Research Chattogram', 'সিএসসিআর হাসপাতাল', 43, NULL, NULL),
  ('Parkview Hospital Chattogram', 'পার্কভিউ হাসপাতাল', 43, NULL, NULL),
  ('Chattogram Medical University Hospital', 'চট্টগ্রাম মেডিকেল বিশ্ববিদ্যালয় হাসপাতাল', 43, NULL, NULL),
  ('Sylhet MAG Osmani Medical College Hospital', 'সিলেট এম এ জি ওসমানী মেডিকেল কলেজ হাসপাতাল', 54, NULL, NULL),
  ('Sylhet Sadar Hospital', 'সিলেট সদর হাসপাতাল', 54, NULL, NULL),
  ('Jalalabad Ragib-Rabeya Medical College Hospital', 'জালালাবাদ রাগীব-রাবেয়া মেডিকেল কলেজ হাসপাতাল', 54, NULL, NULL),
  ('North East Medical College Hospital Sylhet', 'নর্থ ইস্ট মেডিকেল কলেজ হাসপাতাল', 54, NULL, NULL),
  ('Ibn Sina Hospital Sylhet', 'ইবনে সিনা হাসপাতাল সিলেট', 54, NULL, NULL),
  ('Mount Adora Hospital Sylhet', 'মাউন্ট এডোরা হাসপাতাল', 54, NULL, NULL),
  ('Rajshahi Medical College Hospital', 'রাজশাহী মেডিকেল কলেজ হাসপাতাল', 24, NULL, NULL),
  ('Rajshahi Sadar Hospital', 'রাজশাহী সদর হাসপাতাল', 24, NULL, NULL),
  ('Islami Bank Medical College Hospital Rajshahi', 'ইসলামী ব্যাংক মেডিকেল কলেজ হাসপাতাল', 24, NULL, NULL),
  ('Rajshahi Christian Mission Hospital', 'রাজশাহী খ্রিস্টান মিশন হাসপাতাল', 24, NULL, NULL),
  ('Khulna Medical College Hospital', 'খুলনা মেডিকেল কলেজ হাসপাতাল', 59, NULL, NULL),
  ('Khulna General Hospital', 'খুলনা জেনারেল হাসপাতাল', 59, NULL, NULL),
  ('Gazi Medical College Hospital Khulna', 'গাজী মেডিকেল কলেজ হাসপাতাল', 59, NULL, NULL),
  ('Ad-din Akij Medical College Hospital Khulna', 'আদ-দ্বীন আকিজ মেডিকেল কলেজ হাসপাতাল', 59, NULL, NULL),
  ('Khulna Shishu Hospital', 'খুলনা শিশু হাসপাতাল', 59, NULL, NULL)
on conflict do nothing;
