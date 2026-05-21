import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@ApiTags('search')
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Search + filter + browse marketplace listings. */
  @Get('search')
  query(@Query() q: SearchQueryDto) {
    return this.search.search(q);
  }

  /** Category tree for browse navigation. */
  @Get('categories')
  categories() {
    return this.search.categoryTree();
  }
}
