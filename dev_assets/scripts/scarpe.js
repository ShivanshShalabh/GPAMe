(async () => {
  const courses = [];

  // STEP 1: collect all coids
  for (let page = 1; page <= 40; page++) {
    const url =
      `https://catalogs.buffalo.edu/content.php` +
      `?catoid=21` +
      `&navoid=1161` +
      `&filter%5Bitem_type%5D=3` +
      `&filter%5Bonly_active%5D=1` +
      `&filter%5B3%5D=1` +
      `&filter%5Bcpage%5D=${page}`;

    console.log(`Scanning page ${page}`);

    const html = await fetch(url).then(r => r.text());

    const doc = new DOMParser().parseFromString(html, "text/html");

    const links = [...doc.querySelectorAll('a[href*="coid="]')];

    for (const a of links) {
      const href = a.getAttribute("href");

      const match = href.match(/coid=(\d+)/);

      if (!match) continue;

      courses.push({
        coid: match[1],
        title: a.textContent.replace(/\u00a0/g, " ").trim()
      });
    }

    await new Promise(r => setTimeout(r, 100));
  }

  // dedupe
  const uniqueCourses = Object.values(
    courses.reduce((acc, c) => {
      acc[c.coid] = c;
      return acc;
    }, {})
  );

  console.log(`Found ${uniqueCourses.length} unique courses`);

  // STEP 2: fetch preview HTML for every course
  const fullData = [];

  for (let i = 0; i < uniqueCourses.length; i++) {
    const course = uniqueCourses[i];

    const previewUrl =
      `https://catalogs.buffalo.edu/ajax/preview_course.php` +
      `?catoid=21` +
      `&coid=${course.coid}` +
      `&link_text=` +
      `&display_options=a:2:{s:8:~location~;s:8:~template~;s:28:~course_program_display_field~;s:0:~~;}` +
      `&show`;

    console.log(
      `[${i + 1}/${uniqueCourses.length}] Fetching ${course.coid}`
    );

    try {
      const html = await fetch(previewUrl, {
        headers: {
          "x-requested-with": "XMLHttpRequest"
        }
      }).then(r => r.text());

      const doc = new DOMParser().parseFromString(html, "text/html");

      const title =
        doc.querySelector(".courseblocktitle")
          ?.textContent
          ?.replace(/\u00a0/g, " ")
          ?.trim() || course.title;

      const desc =
        doc.querySelector(".courseblockdesc")
          ?.textContent
          ?.replace(/\u00a0/g, " ")
          ?.trim() || "";

      fullData.push({
        coid: course.coid,
        title,
        description: desc,
        rawHtml: html
      });

    } catch (err) {
      console.error("Failed:", course.coid, err);
    }

    // don't DDOS the ancient campus server relic
    await new Promise(r => setTimeout(r, 150));
  }

  console.log("DONE", fullData);

  // STEP 3: download json
  const blob = new Blob(
    [JSON.stringify(fullData, null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ub_full_courses.json";
  a.click();
})();